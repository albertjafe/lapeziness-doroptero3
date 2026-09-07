(function() {
  'use strict';

  const STORAGE_KEY = 'alberto_metronome_v1';
  const MIN_BPM = 30;
  const MAX_BPM = 240;
  const MIN_BEATS = 1;
  const MAX_BEATS = 16;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SECONDS = 0.12;
  const BEAT_TYPES = ['accent', 'normal', 'mute'];

  let audioContext = null;
  let clickBuffer = null;
  let clickBufferContext = null;
  let clickGraphNodes = null;
  let audioRecoveryPromise = null;
  let forceRecoveryRequested = false;
  let audioNeedsGestureReset = false;
  let audioFailureCount = 0;
  let schedulerTimer = null;
  let nextBeatTime = 0;
  let beatIndex = 0;
  let visualTimers = [];
  let tapTimes = [];

  const state = loadState();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultPattern(length, accented) {
    const pattern = Array.from({ length: clamp(Number(length) || 4, MIN_BEATS, MAX_BEATS) }, function() {
      return 'normal';
    });
    if (accented !== false) pattern[0] = 'accent';
    return pattern;
  }

  function normalizePattern(pattern, legacyCount, legacyAccent) {
    if (!Array.isArray(pattern) || !pattern.length) return defaultPattern(legacyCount, legacyAccent);
    const normalized = pattern.slice(0, MAX_BEATS).map(function(type) {
      return BEAT_TYPES.includes(type) ? type : 'normal';
    });
    return normalized.length ? normalized : defaultPattern(4, true);
  }

  function loadState() {
    const fallback = { bpm: 80, pattern: defaultPattern(4, true), playing: false };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored) return fallback;
      return {
        bpm: clamp(Number(stored.bpm) || fallback.bpm, MIN_BPM, MAX_BPM),
        pattern: normalizePattern(stored.pattern, stored.beatsPerBar, stored.accent),
        playing: false,
      };
    } catch (error) {
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bpm: state.bpm,
        pattern: state.pattern,
        beatsPerBar: state.pattern.length,
      }));
    } catch (error) {}
  }

  function tempoName(bpm) {
    if (bpm < 45) return 'Grave';
    if (bpm < 60) return 'Largo';
    if (bpm < 76) return 'Adagio';
    if (bpm < 108) return 'Andante';
    if (bpm < 120) return 'Moderato';
    if (bpm < 168) return 'Allegro';
    if (bpm < 200) return 'Presto';
    return 'Prestissimo';
  }

  function disconnectClickGraph() {
    if (!clickGraphNodes) return;
    ['compressor', 'reverb', 'master', 'limiter'].forEach(function(key) {
      try { clickGraphNodes[key] && clickGraphNodes[key].disconnect(); } catch (error) {}
    });
    clickGraphNodes = null;
  }

  function resetAudio(reason) {
    const old = audioContext;
    audioContext = null;
    clickBuffer = null;
    clickBufferContext = null;
    disconnectClickGraph();
    audioFailureCount = 0;
    if (old && old.state !== 'closed') {
      try {
        const closing = old.close();
        if (closing && typeof closing.catch === 'function') closing.catch(function() {});
      } catch (error) {}
    }
    if (reason) document.documentElement.dataset.metronomeAudioReset = reason;
  }

  function ensureAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (audioContext && audioContext.state === 'closed') resetAudio('closed');
    if (!audioContext) {
      try {
        audioContext = new AudioContextClass({ latencyHint: 'interactive' });
        const created = audioContext;
        created.addEventListener?.('statechange', function() {
          if (audioContext !== created) return;
          if (created.state === 'closed' || created.state === 'interrupted') {
            audioNeedsGestureReset = true;
          }
        });
      } catch (error) {
        audioFailureCount += 1;
        return null;
      }
    }
    if (!clickBuffer || clickBufferContext !== audioContext) {
      clickBuffer = createClickBuffer(audioContext);
      clickBufferContext = audioContext;
    }
    return audioContext;
  }

  async function activateAudio(forceReset) {
    if (forceReset) resetAudio('gesture-refresh');
    const context = ensureAudio();
    if (!context) return null;
    if (context.state === 'suspended' || context.state === 'interrupted') {
      try { await context.resume(); } catch (error) { audioFailureCount += 1; }
    }
    if (context.state !== 'running') {
      audioFailureCount += 1;
      if (audioFailureCount >= 2) audioNeedsGestureReset = true;
      return null;
    }
    audioFailureCount = 0;
    return context;
  }

  // Click deliberadamente brillante y estridente: atraviesa el sonido del piano
  // sin depender de graves que los altavoces pequeños del iPad apenas reproducen.
  function createClickBuffer(context) {
    const sampleRate = context.sampleRate;
    const duration = 0.055;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previousNoise = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate;

      // Crujido: transitorio de ruido pasa-altos muy corto.
      const noise = Math.random() * 2 - 1;
      const highPassed = noise - previousNoise * 0.92;
      previousNoise = noise;
      const crack = highPassed * Math.exp(-t / 0.0016);

      // Campana metálica corta: varias parciales agudas y no armónicas.
      const edge =
        Math.sin(2 * Math.PI * 2700 * t) * 0.62 +
        Math.sin(2 * Math.PI * 4100 * t) * 0.42 +
        Math.sin(2 * Math.PI * 6100 * t) * 0.18;
      const edgeEnv = Math.exp(-t / 0.019);

      // Un núcleo medio evita que el click se vuelva fino sin restarle ataque.
      const body = Math.sin(2 * Math.PI * 980 * t) * Math.exp(-t / 0.027);

      data[i] = crack * 1.05 + edge * edgeEnv * 1.1 + body * 0.38;
    }

    // Normalizar a un pico alto pero sin recortar.
    let peak = 0;
    for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) {
      const scale = 0.98 / peak;
      for (let i = 0; i < length; i += 1) data[i] *= scale;
    }
    return buffer;
  }

  // Reverberación corta y densa para que el click respire y suene más grande.
  function createImpulseResponse(context, duration, decay) {
    const sampleRate = context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const impulse = context.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / duration, decay);
      }
    }
    return impulse;
  }

  function clickGraph(context) {
    if (!clickGraphNodes || clickGraphNodes.context !== context) {
      disconnectClickGraph();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 5;
      compressor.ratio.value = 10;
      compressor.attack.value = 0.001;
      compressor.release.value = 0.11;

      const reverb = context.createConvolver();
      reverb.buffer = createImpulseResponse(context, 0.7, 2.6);

      const master = context.createGain();
      master.gain.value = 2.35;

      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.16;

      compressor.connect(master);
      reverb.connect(master);
      master.connect(limiter);
      limiter.connect(context.destination);

      clickGraphNodes = { context: context, compressor: compressor, reverb: reverb, master: master, limiter: limiter };
    }
    return clickGraphNodes;
  }

  function scheduleClick(time, type) {
    if (type === 'mute') return;
    const context = ensureAudio();
    if (!context || context.state !== 'running' || !clickBuffer) return;
    const accented = type === 'accent';
    const graph = clickGraph(context);

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const dryGain = context.createGain();
    const wetGain = context.createGain();

    source.buffer = clickBuffer;
    source.playbackRate.value = accented ? 0.92 : 1.12;

    filter.type = 'peaking';
    filter.frequency.value = accented ? 2700 : 3400;
    filter.Q.value = 1.15;
    filter.gain.value = accented ? 9 : 7;

    const dryPeak = accented ? 2.8 : 2.1;
    dryGain.gain.setValueAtTime(dryPeak, time);
    dryGain.gain.exponentialRampToValueAtTime(0.001, time + (accented ? 0.075 : 0.055));

    const wetLevel = accented ? 0.38 : 0.26;
    wetGain.gain.setValueAtTime(wetLevel, time);
    wetGain.gain.exponentialRampToValueAtTime(0.001, time + (accented ? 0.12 : 0.09));

    source.connect(filter);
    filter.connect(dryGain);
    filter.connect(wetGain);
    dryGain.connect(graph.compressor);
    wetGain.connect(graph.reverb);

    source.start(time);
    source.stop(time + 0.08);
  }

  function clearVisualTimers() {
    visualTimers.forEach(clearTimeout);
    visualTimers = [];
  }

  function showBeat(index, atTime) {
    const context = audioContext;
    const delay = context ? Math.max(0, (atTime - context.currentTime) * 1000) : 0;
    visualTimers.push(setTimeout(function() {
      document.querySelectorAll('.crono-metronome').forEach(function(surface) {
        surface.querySelectorAll('.crono-metronome-beat').forEach(function(dot, dotIndex) {
          dot.classList.toggle('active', dotIndex === index);
        });
        surface.classList.remove('is-pulsing');
        void surface.offsetWidth;
        surface.classList.add('is-pulsing');
      });
    }, delay));
  }

  function scheduler() {
    if (!state.playing || !audioContext) return;
    if (audioContext.state !== 'running') {
      recoverAudio(false);
      return;
    }
    if (nextBeatTime < audioContext.currentTime - 0.5) {
      beatIndex = 0;
      nextBeatTime = audioContext.currentTime + 0.055;
    }
    let scheduled = 0;
    while (nextBeatTime < audioContext.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const type = state.pattern[beatIndex] || 'normal';
      scheduleClick(nextBeatTime, type);
      showBeat(beatIndex, nextBeatTime);
      nextBeatTime += 60 / state.bpm;
      beatIndex = (beatIndex + 1) % state.pattern.length;
      scheduled += 1;
      if (scheduled >= 16) break;
    }
  }

  async function start() {
    stop(false);
    state.playing = true;
    render();
    const context = await activateAudio(audioNeedsGestureReset);
    audioNeedsGestureReset = false;
    if (!context) {
      audioNeedsGestureReset = true;
      if (typeof showToast === 'function') showToast('El audio no está disponible en este dispositivo');
      stop();
      return;
    }
    if (!state.playing) return;
    beatIndex = 0;
    nextBeatTime = context.currentTime + 0.055;
    scheduler();
    schedulerTimer = setInterval(scheduler, LOOKAHEAD_MS);
    render();
  }

  function recoverAudio(forceReset) {
    if (forceReset) forceRecoveryRequested = true;
    if (audioRecoveryPromise) return audioRecoveryPromise;
    const shouldForceReset = forceRecoveryRequested;
    forceRecoveryRequested = false;
    if (schedulerTimer) clearInterval(schedulerTimer);
    schedulerTimer = null;
    audioRecoveryPromise = activateAudio(shouldForceReset).then(function(context) {
      if (!context || !state.playing) return false;
      beatIndex = 0;
      nextBeatTime = context.currentTime + 0.055;
      scheduler();
      schedulerTimer = setInterval(scheduler, LOOKAHEAD_MS);
      return true;
    }).finally(function() {
      audioRecoveryPromise = null;
      if (forceRecoveryRequested && state.playing) recoverAudio(true);
    });
    return audioRecoveryPromise;
  }

  function stop(shouldRender) {
    state.playing = false;
    if (schedulerTimer) clearInterval(schedulerTimer);
    schedulerTimer = null;
    clearVisualTimers();
    document.querySelectorAll('.crono-metronome-beat').forEach(function(dot) {
      dot.classList.remove('active');
    });
    if (shouldRender !== false) render();
  }

  function toggle() {
    if (state.playing) stop();
    else start();
  }

  function reschedule() {
    if (!state.playing || !audioContext) return;
    clearVisualTimers();
    beatIndex = 0;
    nextBeatTime = audioContext.currentTime + 0.055;
  }

  function setBpm(value, announce) {
    state.bpm = Math.round(clamp(Number(value) || state.bpm, MIN_BPM, MAX_BPM));
    saveState();
    reschedule();
    renderTempo();
    if (announce && typeof Haptics !== 'undefined') {
      try { Haptics.tick(); } catch (error) {}
    }
  }

  function adjust(delta) {
    setBpm(state.bpm + Number(delta || 0), true);
  }

  function setBeatCount(value) {
    const target = Math.round(clamp(Number(value) || state.pattern.length, MIN_BEATS, MAX_BEATS));
    if (target === state.pattern.length) return;
    if (target > state.pattern.length) {
      while (state.pattern.length < target) state.pattern.push('normal');
    } else {
      state.pattern = state.pattern.slice(0, target);
    }
    beatIndex = 0;
    saveState();
    reschedule();
    render();
    try { Haptics.light(); } catch (error) {}
  }

  function changeBeatCount(delta) {
    setBeatCount(state.pattern.length + Number(delta || 0));
  }

  function cycleBeat(index) {
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0 || position >= state.pattern.length) return;
    const current = state.pattern[position];
    state.pattern[position] = BEAT_TYPES[(BEAT_TYPES.indexOf(current) + 1) % BEAT_TYPES.length];
    saveState();
    reschedule();
    render();
    try { Haptics.tick(); } catch (error) {}
  }

  async function tap() {
    const now = performance.now();
    if (!tapTimes.length || now - tapTimes[tapTimes.length - 1] > 2200) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 7) tapTimes.shift();
    const context = await activateAudio(audioNeedsGestureReset);
    audioNeedsGestureReset = false;
    if (!context) audioNeedsGestureReset = true;
    if (context) scheduleClick(context.currentTime + 0.005, 'normal');
    document.querySelectorAll('.crono-metronome-tap').forEach(function(button) {
      button.classList.remove('is-tapped');
      void button.offsetWidth;
      button.classList.add('is-tapped');
    });
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i += 1) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const recent = intervals.slice(-5);
      const average = recent.reduce(function(sum, interval) { return sum + interval; }, 0) / recent.length;
      setBpm(60000 / average, false);
    }
  }

  function beatText(type) {
    if (type === 'accent') return 'fuerte';
    if (type === 'mute') return 'silencio';
    return 'normal';
  }

  function nextBeatText(type) {
    if (type === 'accent') return 'normal';
    if (type === 'normal') return 'silencio';
    return 'fuerte';
  }

  function beatDots() {
    return state.pattern.map(function(type, index) {
      const label = 'Pulso ' + (index + 1) + ': ' + beatText(type) + '. Pulsa para cambiar a ' + nextBeatText(type);
      return '<button type="button" class="crono-metronome-beat is-' + type + '" onclick="metronomeCycleBeat(' + index + ')" aria-label="' + label + '" title="' + label + '"><span>' + (index + 1) + '</span></button>';
    }).join('');
  }

  function surfaceHtml() {
    const count = state.pattern.length;
    const mobileColumns = count > 8 ? Math.ceil(count / 2) : count;
    return '<div class="crono-metronome-shell' + (state.playing ? ' is-playing' : '') + '">' +
      '<div class="crono-metronome-pattern">' +
        '<div class="crono-metronome-pattern-meta"><span class="crono-metronome-status">' + (state.playing ? 'EN MARCHA' : 'LISTO') + '</span><strong>' + count + ' ' + (count === 1 ? 'pulso' : 'pulsos') + '</strong></div>' +
        '<div class="crono-metronome-pattern-editor">' +
          '<button type="button" class="crono-metronome-count-btn" onclick="metronomeChangeBeatCount(-1)" aria-label="Quitar un pulso"' + (count <= MIN_BEATS ? ' disabled' : '') + '>−</button>' +
          '<div class="crono-metronome-beats" role="group" aria-label="Patrón del compás" style="--metro-beat-count:' + count + ';--metro-mobile-columns:' + mobileColumns + '">' + beatDots() + '</div>' +
          '<button type="button" class="crono-metronome-count-btn" onclick="metronomeChangeBeatCount(1)" aria-label="Añadir un pulso"' + (count >= MAX_BEATS ? ' disabled' : '') + '>+</button>' +
        '</div>' +
        '<div class="crono-metronome-legend" aria-hidden="true"><span><i class="is-accent"></i>Fuerte</span><span><i class="is-normal"></i>Normal</span><span><i class="is-mute"></i>Silencio</span></div>' +
      '</div>' +
      '<div class="crono-metronome-main">' +
        '<div class="crono-metronome-step crono-metronome-step-left"><button type="button" onclick="metronomeAdjust(-5)">−5</button><button type="button" onclick="metronomeAdjust(-1)">−1</button></div>' +
        '<div class="crono-metronome-tempo"><strong>' + state.bpm + '</strong><span>BPM · ' + tempoName(state.bpm) + '</span></div>' +
        '<div class="crono-metronome-step crono-metronome-step-right"><button type="button" onclick="metronomeAdjust(1)">+1</button><button type="button" onclick="metronomeAdjust(5)">+5</button></div>' +
      '</div>' +
      '<input class="crono-metronome-slider" type="range" min="' + MIN_BPM + '" max="' + MAX_BPM + '" step="1" value="' + state.bpm + '" aria-label="Tempo en pulsos por minuto" oninput="metronomeSetBpm(this.value)">' +
      '<div class="crono-metronome-foot">' +
        '<button type="button" class="crono-metronome-tap" onclick="metronomeTap()"><span>TAP</span><small>marca el tempo</small></button>' +
        '<button type="button" class="crono-metronome-play' + (state.playing ? ' is-playing' : '') + '" onclick="metronomeToggle()" aria-label="' + (state.playing ? 'Detener metrónomo' : 'Iniciar metrónomo') + '"><span aria-hidden="true"></span></button>' +
      '</div>' +
    '</div>';
  }

  function renderTempo() {
    document.querySelectorAll('.crono-metronome').forEach(function(surface) {
      const tempo = surface.querySelector('.crono-metronome-tempo strong');
      const label = surface.querySelector('.crono-metronome-tempo span');
      const slider = surface.querySelector('.crono-metronome-slider');
      if (tempo) {
        tempo.textContent = String(state.bpm);
        tempo.classList.remove('is-changing');
        void tempo.offsetWidth;
        tempo.classList.add('is-changing');
      }
      if (label) label.textContent = 'BPM · ' + tempoName(state.bpm);
      if (slider && document.activeElement !== slider) slider.value = String(state.bpm);
    });
  }

  function render() {
    document.querySelectorAll('.crono-metronome').forEach(function(surface) {
      surface.innerHTML = surfaceHtml();
    });
    document.body.classList.toggle('crono-metronome-playing', state.playing);
  }

  window.metronomeRender = render;
  window.metronomeToggle = toggle;
  window.metronomeAdjust = adjust;
  window.metronomeSetBpm = setBpm;
  window.metronomeSetBeats = setBeatCount;
  window.metronomeChangeBeatCount = changeBeatCount;
  window.metronomeCycleBeat = cycleBeat;
  window.metronomeTap = tap;
  window.__metronomeDebug = {
    getState: function() {
      return { bpm: state.bpm, pattern: state.pattern.slice(), beatsPerBar: state.pattern.length, playing: state.playing };
    },
    stop: stop,
    audio: function() {
      return { state: audioContext ? audioContext.state : 'none', failures: audioFailureCount, needsGestureReset: audioNeedsGestureReset };
    },
    recoverAudio: recoverAudio,
  };

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      audioNeedsGestureReset = true;
      if (schedulerTimer) clearInterval(schedulerTimer);
      schedulerTimer = null;
    } else if (state.playing) {
      // Primero intentamos reanudar el contexto existente. El siguiente gesto
      // fuerza uno nuevo para los casos en que iOS devuelve un contexto zombi.
      recoverAudio(false);
    }
  });
  window.addEventListener('focus', function() {
    if (state.playing) recoverAudio(false);
  });
  window.addEventListener('pageshow', function(event) {
    if (event.persisted) resetAudio('bfcache');
    if (state.playing) recoverAudio(Boolean(event.persisted));
  });
  ['pointerdown', 'touchstart', 'keydown'].forEach(function(eventName) {
    document.addEventListener(eventName, function() {
      if (state.playing && audioNeedsGestureReset) {
        audioNeedsGestureReset = false;
        recoverAudio(true);
      }
    }, eventName === 'keydown' ? false : { passive: true });
  });

  // Permite ajustar el tempo con la rueda del ratón o el scroll del trackpad
  // sobre el slider. Shift acelera el paso de 1 a 5 BPM.
  document.addEventListener('wheel', function(event) {
    const slider = event.target && event.target.closest && event.target.closest('.crono-metronome-slider');
    if (!slider) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    setBpm(state.bpm + (event.deltaY < 0 ? step : -step), true);
  }, { passive: false });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
