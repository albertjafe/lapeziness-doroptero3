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
  let clickGraphNodes = null;
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

  function ensureAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    if (audioContext.state === 'suspended') audioContext.resume().catch(function() {});
    if (!clickBuffer) clickBuffer = createClickBuffer(audioContext);
    return audioContext;
  }

  // Click con cuerpo: crujido agudo, resonancia de madera y un golpe grave.
  // Suena como un metrónomo mecánico fuerte en vez de un pitido seco.
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
      const highPassed = noise - previousNoise * 0.86;
      previousNoise = noise;
      const crack = highPassed * Math.exp(-t / 0.0009);

      // Cuerpo de madera: dos senos amortiguados con un ligero barrido hacia abajo.
      const sweep = 1 + 0.16 * Math.exp(-t / 0.0018);
      const wood =
        Math.sin(2 * Math.PI * 1500 * sweep * t) * 0.66 +
        Math.sin(2 * Math.PI * 320 * t) * 0.34;
      const woodEnv = Math.exp(-t / 0.012);

      // Golpe grave para dar peso.
      const thump = Math.sin(2 * Math.PI * 170 * t) * Math.exp(-t / 0.022);

      data[i] = crack * 0.82 + wood * woodEnv * 0.92 + thump * 0.55;
    }

    // Normalizar a un pico alto pero sin recortar.
    let peak = 0;
    for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) {
      const scale = 0.92 / peak;
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
    if (!clickGraphNodes) {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 8;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.001;
      compressor.release.value = 0.08;

      const reverb = context.createConvolver();
      reverb.buffer = createImpulseResponse(context, 0.7, 2.6);

      const master = context.createGain();
      master.gain.value = 1.65;

      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.16;

      compressor.connect(master);
      reverb.connect(master);
      master.connect(limiter);
      limiter.connect(context.destination);

      clickGraphNodes = { compressor: compressor, reverb: reverb };
    }
    return clickGraphNodes;
  }

  function scheduleClick(time, type) {
    if (type === 'mute') return;
    const context = ensureAudio();
    if (!context || !clickBuffer) return;
    const accented = type === 'accent';
    const graph = clickGraph(context);

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const dryGain = context.createGain();
    const wetGain = context.createGain();

    source.buffer = clickBuffer;
    source.playbackRate.value = accented ? 0.86 : 1.05;

    filter.type = 'peaking';
    filter.frequency.value = accented ? 1500 : 1900;
    filter.Q.value = 0.9;
    filter.gain.value = accented ? 5.2 : 4.2;

    const dryPeak = accented ? 2.1 : 1.45;
    dryGain.gain.setValueAtTime(dryPeak, time);
    dryGain.gain.exponentialRampToValueAtTime(0.001, time + (accented ? 0.075 : 0.055));

    const wetLevel = accented ? 0.62 : 0.42;
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
    while (nextBeatTime < audioContext.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const type = state.pattern[beatIndex] || 'normal';
      scheduleClick(nextBeatTime, type);
      showBeat(beatIndex, nextBeatTime);
      nextBeatTime += 60 / state.bpm;
      beatIndex = (beatIndex + 1) % state.pattern.length;
    }
  }

  function start() {
    const context = ensureAudio();
    if (!context) {
      if (typeof showToast === 'function') showToast('El audio no está disponible en este dispositivo');
      return;
    }
    stop(false);
    state.playing = true;
    beatIndex = 0;
    nextBeatTime = context.currentTime + 0.055;
    scheduler();
    schedulerTimer = setInterval(scheduler, LOOKAHEAD_MS);
    render();
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

  function tap() {
    const now = performance.now();
    if (!tapTimes.length || now - tapTimes[tapTimes.length - 1] > 2200) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 7) tapTimes.shift();
    const context = ensureAudio();
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
  };

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
