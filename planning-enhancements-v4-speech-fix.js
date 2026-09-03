/* Hotfix: restore task dictation on iPhone/iPad after planning v4 suppressed Web Speech. */
(function planningV4SpeechFix(){
  'use strict';

  function isIOS(){
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  }

  function restoreRecognition(name){
    const Recognition = window[name];
    if(typeof Recognition !== 'function' || !Recognition.prototype) return false;
    const proto = Recognition.prototype;
    const original = proto.__planningV4OriginalStart;
    if(typeof original === 'function'){
      try {
        proto.start = original;
        proto.__planningV4Suppressed = false;
        return true;
      } catch(error){
        console.warn('[planning-v4-speech-fix] no se pudo restaurar', name, error);
      }
    }
    return false;
  }

  function refreshHints(){
    document.documentElement.classList.remove('planning-ios-keyboard-dictation');

    document.querySelectorAll('.ios-keyboard-dictation-hint').forEach(node => node.remove());
    document.querySelectorAll('#cronoIdleTaskInput, #cronoTaskInput, input[id*="TaskInput"], textarea[id*="TaskInput"], .crono-task-input').forEach(input => {
      input.dataset.keyboardDictationHint = 'v4';
    });

    const tomorrowHint = document.querySelector('#modalCronoNote .crono-note-hint');
    if(tomorrowHint){
      tomorrowHint.textContent = 'Pulsa el micrófono para dictar. En iPhone/iPad, el navegador puede pedir permiso de micrófono para esta función.';
      tomorrowHint.dataset.keyboardDictation = 'speech-restored';
    }
  }

  function install(){
    if(!isIOS()) return;

    // Planning v4 may have replaced SpeechRecognition.start with a no-op. Put
    // the native/browser implementation back so the existing task UI can once
    // again auto-start dictation when "Añadir tarea" is opened.
    restoreRecognition('SpeechRecognition');
    restoreRecognition('webkitSpeechRecognition');

    // Keep this true deliberately: it prevents planning v4 from trying to
    // suppress the API again on a later boot pass, while the native start()
    // method remains restored.
    window.__planningV4SpeechSuppressed = true;
    refreshHints();

    if(!window.__planningV4SpeechFixObserver){
      const observer = new MutationObserver(() => {
        if(document.documentElement.classList.contains('planning-ios-keyboard-dictation')) refreshHints();
      });
      observer.observe(document.documentElement, { attributes:true, attributeFilter:['class'] });
      window.__planningV4SpeechFixObserver = observer;
    }

    window.PlanningV4SpeechFix = { restored:true, isIOS };
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
