(function(root) {
  'use strict';

  const STORAGE_KEY = 'alberto_web_push_v1';
  const VAPID_PUBLIC_KEY = 'BPM7phxT-XUZ1b0SVL1ZDy6UN0eL8c1wQBYMIEiq2IEe1v56DGxeMVhQYEbepOpU0gi3fEW2pIyEn2ZIu2LninU';

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (error) {
      return {};
    }
  }

  function writeState(next) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (error) {}
  }

  function supported() {
    return !root.__ESTUDIO_NATIVE__ &&
      'serviceWorker' in navigator &&
      'PushManager' in root &&
      'Notification' in root;
  }

  function isActive() {
    const state = readState();
    return supported() && Notification.permission === 'granted' && state.registered === true;
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = root.atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function currentUser() {
    if (typeof root.getSB !== 'function') return null;
    const { data, error } = await root.getSB().auth.getUser();
    if (error) throw error;
    return data && data.user ? data.user : null;
  }

  function setStatus(text, tone, buttonText, disabled) {
    const status = document.getElementById('pushNotificationStatus');
    const dot = document.getElementById('pushNotificationDot');
    const button = document.getElementById('pushNotificationEnableBtn');
    if (status) status.textContent = text;
    if (dot) dot.dataset.tone = tone || 'neutral';
    if (button) {
      button.textContent = buttonText || 'Activar avisos';
      button.disabled = !!disabled;
    }
  }

  async function refreshUI() {
    if (!supported()) {
      setStatus('Instala la app en la pantalla de inicio para activarlos', 'neutral', 'No disponible', true);
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('Bloqueados en los ajustes del iPad', 'error', 'Bloqueados', true);
      return;
    }
    if (isActive()) {
      setStatus('Activos incluso con la app en segundo plano', 'success', 'Avisos activos', true);
      return;
    }
    try {
      const user = await currentUser();
      if (!user) {
        setStatus('Conecta tu cuenta para recibirlos', 'warning', 'Conectar cuenta', false);
        return;
      }
    } catch (error) {
      setStatus('No se ha podido comprobar la cuenta', 'warning', 'Reintentar', false);
      return;
    }
    setStatus('Pendientes de activar en este dispositivo', 'neutral', 'Activar avisos', false);
  }

  async function enableFromGesture(options) {
    const opts = options || {};
    if (!supported()) {
      if (!opts.silent && typeof root.showToast === 'function') {
        root.showToast('En iPad, instala primero la app en la pantalla de inicio');
      }
      await refreshUI();
      return false;
    }

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (!opts.silent && typeof root.showToast === 'function') root.showToast('Los avisos no se han activado');
      await refreshUI();
      return false;
    }

    try {
      const user = await currentUser();
      if (!user) {
        if (!opts.silent && typeof root.showToast === 'function') root.showToast('Conecta tu cuenta para activar los avisos');
        await refreshUI();
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const json = subscription.toJSON();
      const { error } = await root.getSB().from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        subscription: json,
        user_agent: navigator.userAgent,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,endpoint' });
      if (error) throw error;

      writeState({ registered: true, endpoint: subscription.endpoint, userId: user.id });
      await refreshUI();
      if (!opts.silent && typeof root.showToast === 'function') root.showToast('Avisos en segundo plano activados');
      return true;
    } catch (error) {
      writeState({ registered: false });
      await refreshUI();
      if (!opts.silent && typeof root.showToast === 'function') root.showToast('No se pudieron activar los avisos');
      console.warn('Web Push registration failed', error);
      return false;
    }
  }

  function elapsedMs(run, now) {
    if (!run || !run.startTs) return 0;
    const end = run.state === 'paused' && run.pauseStartTs ? run.pauseStartTs : now;
    return Math.max(0, end - run.startTs - (Number(run.pausedMs) || 0));
  }

  function runSnapshot(run, now) {
    if (!run || !run.runId || run.state !== 'running') return null;
    const currentTime = Number(now) || Date.now();
    const elapsed = elapsedMs(run, currentTime);
    const target = Number(run.targetDurationMs) > 0
      ? Number(run.targetDurationMs)
      : (Number(run.targetMinutes) > 0 ? Number(run.targetMinutes) * 60000 : null);
    return {
      run_id: run.runId,
      mode: target == null ? 'stopwatch' : 'timer',
      is_rest: !!run.isRest,
      work_name: run.displayName || (run.isRest ? 'Descanso' : 'Sesión de estudio'),
      started_at: new Date(currentTime - elapsed).toISOString(),
      ends_at: target == null ? null : new Date(currentTime + Math.max(0, target - elapsed)).toISOString(),
      status: 'active',
      updated_at: new Date(currentTime).toISOString(),
    };
  }

  async function syncRun(options) {
    if (!isActive() || !root.crono) return false;
    const snapshot = runSnapshot(root.crono, Date.now());
    if (!snapshot) return false;
    try {
      const user = await currentUser();
      if (!user) return false;
      snapshot.user_id = user.id;
      if (options && options.resetCountdown) snapshot.sent_countdown = [];
      if (options && options.resetMilestones) snapshot.last_milestone_minutes = 0;
      const { error } = await root.getSB().from('push_timer_runs').upsert(snapshot, {
        onConflict: 'user_id,run_id',
      });
      if (error) throw error;
      return true;
    } catch (error) {
      console.warn('Web Push timer sync failed', error);
      return false;
    }
  }

  async function setRunStatus(runId, status) {
    if (!isActive() || !runId) return false;
    try {
      const user = await currentUser();
      if (!user) return false;
      const { error } = await root.getSB().from('push_timer_runs')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('run_id', runId);
      if (error) throw error;
      return true;
    } catch (error) {
      console.warn('Web Push timer status failed', error);
      return false;
    }
  }

  function pauseRun(runId) { return setRunStatus(runId, 'paused'); }
  function cancelRun(runId) { return setRunStatus(runId, 'cancelled'); }
  function completeRun(runId) { return setRunStatus(runId, 'completed'); }

  root.StudyPush = {
    VAPID_PUBLIC_KEY,
    supported,
    isActive,
    refreshUI,
    enableFromGesture,
    runSnapshot,
    syncRun,
    pauseRun,
    cancelRun,
    completeRun,
  };
  root.enableReliableNotifications = function() { return enableFromGesture({ silent: false }); };
})(typeof window !== 'undefined' ? window : globalThis);
