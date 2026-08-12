(function() {
  'use strict';

  const STORAGE_KEY = 'alberto_metronome_v1';
  const MIN_BPM = 30;
  const MAX_BPM = 240;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SECONDS = 0.12;
  const BEAT_OPTIONS = [2, 3, 4, 6];

  let audioContext = null;
  let clickBuffer = null;
  let schedulerTimer = null;
  let nextBeatTime = 0;
  let beatIndex = 0;
  let visualTimers = [];
  let tapTimes = [];

  const state = loadState();

  function loadState() {
    const fallback = { bpm: 80, beatsPerBar: 4, accent: true, playing: false };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored) return fallback;
      return {
        bpm: clamp(Number(stored.bpm) || fallback.bpm, MIN_BPM, MAX_BPM),
        beatsPerBar: BEAT_OPTIONS.includes(Number(stored.beatsPerBar)) ? Number(stored.beatsPerBar) : fallback.beatsPerBar,
        accent: stored.accent !== false,
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
        beatsPerBar: state.beatsPerBar,
        accent: state.accent,
      }));
    } catch (error) {}
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
    if (!clickBuffer) clickBuffer = createDryClickBuffer(audioContext);
    return audioContext;
  }

  // A very short, high-passed impulse: audible and dry, without a resonant
  // wooden or metallic tail. It is generated locally and bypasses app SFX.
  function createDryClickBuffer(context) {
    const duration = 0.016;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previousNoise = 0;
    for (let i = 0; i < length; i += 1) {
      const noise = Math.random() * 2 - 1;
      const highPassed = noise - previousNoise * 0.91;
      const envelope = Math.exp(-i / (context.sampleRate * 0.0028));
      data[i] = highPassed * envelope * 0.68;
      previousNoise = noise;
    }
    return buffer;
  }

  function scheduleClick(time, accented) {
    const context = ensureAudio();
    if (!context || !clickBuffer) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = clickBuffer;
    source.playbackRate.value = accented ? 0.92 : 1.08;
    filter.type = 'bandpass';
    filter.frequency.value = accented ? 1850 : 2350;
    filter.Q.value = 0.72;
    gain.gain.setValueAtTime(accented ? 0.95 : 0.68, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.022);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(time);
    source.stop(time + 0.028);
  }

  function clearVisualTimers() {
    visualTimers.forEach(clearTimeout);
    visualTimers = [];
  }

  function showBeat(index, accented, atTime) {
    const context = audioContext;
    const delay = context ? Math.max(0, (atTime - context.currentTime) * 1000) : 0;
    visualTimers.push(setTimeout(function() {
      document.querySelectorAll('.crono-metronome').forEach(function(surface) {
        surface.querySelectorAll('.crono-metronome-beat').forEach(function(dot, dotIndex) {
          dot.classList.toggle('active', dotIndex === index);
          dot.classList.toggle('accented', dotIndex === index && accented);
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
      const accented = state.accent && beatIndex === 0;
      scheduleClick(nextBeatTime, accented);
      showBeat(beatIndex, accented, nextBeatTime);
      nextBeatTime += 60 / state.bpm;
      beatIndex = (beatIndex + 1) % state.beatsPerBar;
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
      dot.classList.remove('active', 'accented');
    });
    if (shouldRender !== false) render();
  }

  function toggle() {
    if (state.playing) stop();
    else start();
  }

  function reschedule() {
    if (!state.playing) return;
    clearVisualTimers();
    beatIndex = 0;
    nextBeatTime = audioContext.currentTime + 0.055;
  }

  function setBpm(value, announce) {
    state.bpm = Math.round(clamp(Number(value) || state.bpm, MIN_BPM, MAX_BPM));
    saveState();
    reschedule();
    render();
    if (announce && typeof Haptics !== 'undefined') {
      try { Haptics.tick(); } catch (error) {}
    }
  }

  function adjust(delta) {
    setBpm(state.bpm + Number(delta || 0), true);
  }

  function setBeats(value) {
    const beats = Number(value);
    if (!BEAT_OPTIONS.includes(beats)) return;
    state.beatsPerBar = beats;
    beatIndex = 0;
    saveState();
    reschedule();
    render();
  }

  function toggleAccent() {
    state.accent = !state.accent;
    saveState();
    render();
  }

  function tap() {
    const now = performance.now();
    if (!tapTimes.length || now - tapTimes[tapTimes.length - 1] > 2200) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 7) tapTimes.shift();
    const context = ensureAudio();
    if (context) scheduleClick(context.currentTime + 0.005, false);
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
    } else {
      render();
    }
  }

  function beatDots() {
    let html = '';
    for (let i = 0; i < state.beatsPerBar; i += 1) {
      html += '<i class="crono-metronome-beat" aria-hidden="true"></i>';
    }
    return html;
  }

  function surfaceHtml() {
    return '<div class="crono-metronome-shell' + (state.playing ? ' is-playing' : '') + '">' +
      '<div class="crono-metronome-pulse-row"><span class="crono-metronome-status">' + (state.playing ? 'EN MARCHA' : 'LISTO') + '</span><div class="crono-metronome-beats">' + beatDots() + '</div><button type="button" class="crono-metronome-accent' + (state.accent ? ' active' : '') + '" onclick="metronomeToggleAccent()" aria-pressed="' + state.accent + '" aria-label="' + (state.accent ? 'Desactivar acento del primer pulso' : 'Activar acento del primer pulso') + '">1</button></div>' +
      '<div class="crono-metronome-main">' +
        '<div class="crono-metronome-step crono-metronome-step-left"><button type="button" onclick="metronomeAdjust(-5)">−5</button><button type="button" onclick="metronomeAdjust(-1)">−1</button></div>' +
        '<div class="crono-metronome-tempo"><strong>' + state.bpm + '</strong><span>BPM · ' + tempoName(state.bpm) + '</span></div>' +
        '<div class="crono-metronome-step crono-metronome-step-right"><button type="button" onclick="metronomeAdjust(1)">+1</button><button type="button" onclick="metronomeAdjust(5)">+5</button></div>' +
      '</div>' +
      '<input class="crono-metronome-slider" type="range" min="' + MIN_BPM + '" max="' + MAX_BPM + '" step="1" value="' + state.bpm + '" aria-label="Tempo en pulsos por minuto" oninput="metronomeSetBpm(this.value)">' +
      '<div class="crono-metronome-foot">' +
        '<div class="crono-metronome-meter" role="group" aria-label="Pulsos por compás"><span>Compás</span>' + BEAT_OPTIONS.map(function(beats) { return '<button type="button" class="' + (state.beatsPerBar === beats ? 'active' : '') + '" onclick="metronomeSetBeats(' + beats + ')">' + beats + '</button>'; }).join('') + '</div>' +
        '<button type="button" class="crono-metronome-tap" onclick="metronomeTap()"><span>TAP</span><small>marca el tempo</small></button>' +
        '<button type="button" class="crono-metronome-play' + (state.playing ? ' is-playing' : '') + '" onclick="metronomeToggle()" aria-label="' + (state.playing ? 'Detener metrónomo' : 'Iniciar metrónomo') + '"><span aria-hidden="true"></span></button>' +
      '</div>' +
    '</div>';
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
  window.metronomeSetBeats = setBeats;
  window.metronomeToggleAccent = toggleAccent;
  window.metronomeTap = tap;
  window.__metronomeDebug = {
    getState: function() { return Object.assign({}, state); },
    stop: stop,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
