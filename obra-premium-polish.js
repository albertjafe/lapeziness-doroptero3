(function () {
  'use strict';

  function install(attempt) {
    if (typeof window.openPremiumWork !== 'function') {
      if (attempt < 80) setTimeout(() => install(attempt + 1), 75);
      return;
    }
    if (window.openPremiumWork.__startupResilient) return;

    const original = window.openPremiumWork;
    const resilient = function (id) {
      const result = original.call(this, id);
      if (result !== false) return result;

      // During app startup the sheet module can exist a fraction before the
      // persisted repertoire has been hydrated. A real tap normally happens
      // later, but retry briefly so opening a work is deterministic everywhere.
      let retries = 0;
      const retry = () => {
        retries += 1;
        const opened = original.call(window, id);
        if (opened === false && retries < 20) setTimeout(retry, 75);
      };
      setTimeout(retry, 75);
      return false;
    };
    resilient.__startupResilient = true;
    resilient.__original = original;
    window.openPremiumWork = resilient;
  }

  install(0);
})();
