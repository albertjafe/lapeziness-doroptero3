// UX del cierre de sesión y selección del cronómetro.
// - Explica con detalle la escala subjetiva 1–100 del modal "hecho".
// - Recuerda la última obra + movimiento realmente plantados, no solo la obra.
(function studySessionUx() {
  'use strict';

  const LAST_TARGET_KEY = 'cronoLastStudyTarget_v1';

  function validTargetValue(value) {
    return /^(?:obra|mov)::[^:]+(?:::[^:]+)?$/.test(String(value || ''));
  }

  function readLastTarget() {
    try {
      const value = localStorage.getItem(LAST_TARGET_KEY) || '';
      return validTargetValue(value) ? value : '';
    } catch (error) {
      return '';
    }
  }

  function writeLastTarget(value) {
    if (!validTargetValue(value)) return false;
    try {
      localStorage.setItem(LAST_TARGET_KEY, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function optionExists(select, value) {
    return !!select && !!value && Array.from(select.options || []).some(option => option.value === value);
  }

  function plantTargetValue(plant) {
    if (!plant || !plant.obraId || plant.failed || plant.source === 'forest') return '';
    return plant.movId
      ? 'mov::' + plant.obraId + '::' + plant.movId
      : 'obra::' + plant.obraId;
  }

  function latestRecordedTarget(select) {
    const plants = (window.db && Array.isArray(window.db.sessionPlants)) ? window.db.sessionPlants : [];
    const recent = plants.slice().sort((a, b) => {
      const aTime = new Date(a.endedAt || a.startedAt || 0).getTime() || 0;
      const bTime = new Date(b.endedAt || b.startedAt || 0).getTime() || 0;
      return bTime - aTime;
    });
    for (const plant of recent) {
      const value = plantTargetValue(plant);
      if (optionExists(select, value)) return value;
    }
    return '';
  }

  function exactLastTargetForSelect(select) {
    const stored = readLastTarget();
    if (optionExists(select, stored)) return stored;
    const fromHistory = latestRecordedTarget(select);
    if (fromHistory) writeLastTarget(fromHistory);
    return fromHistory;
  }

  function syncCronoSelectionUi() {
    if (typeof window.cronoUpdateSelectBtn === 'function') window.cronoUpdateSelectBtn();
    if (typeof window.cronoUpdateStartBtn === 'function') window.cronoUpdateStartBtn();
  }

  function installExactLastTargetBehavior() {
    const originalSelectLastUsed = window.cronoSelectLastUsed;
    if (typeof originalSelectLastUsed === 'function' && !originalSelectLastUsed.__exactMovementWrapped) {
      const wrappedSelectLastUsed = function cronoSelectLastUsedExact() {
        if (window.crono && (window.crono.state === 'running' || window.crono.state === 'paused')) return;
        const select = document.getElementById('cronoObraSelect');
        if (!select) return originalSelectLastUsed.apply(this, arguments);

        const exact = exactLastTargetForSelect(select);
        if (exact) {
          select.value = exact;
          syncCronoSelectionUi();
          return;
        }
        return originalSelectLastUsed.apply(this, arguments);
      };
      wrappedSelectLastUsed.__exactMovementWrapped = true;
      window.cronoSelectLastUsed = wrappedSelectLastUsed;
    }

    const originalStart = window.cronoStart;
    if (typeof originalStart === 'function' && !originalStart.__exactMovementWrapped) {
      const wrappedStart = function cronoStartRememberExactTarget() {
        const select = document.getElementById('cronoObraSelect');
        const selectedValue = select ? select.value : '';
        const beforeState = window.crono && window.crono.state;
        const persistIfStarted = () => {
          if (selectedValue && window.crono && window.crono.state === 'running' && beforeState !== 'running') {
            writeLastTarget(selectedValue);
          }
        };
        const result = originalStart.apply(this, arguments);
        if (result && typeof result.then === 'function') {
          return result.then(value => {
            persistIfStarted();
            return value;
          });
        }
        persistIfStarted();
        return result;
      };
      wrappedStart.__exactMovementWrapped = true;
      window.cronoStart = wrappedStart;
    }
  }

  const RATING_RANGES = [
    {
      min: 1,
      max: 14,
      title: 'Exploración',
      text: 'La obra todavía no está realmente montada. Estás leyendo, descifrando notas, ritmo, armonía o coordinación. No puedes recorrerla completa de forma continua y la digitación puede cambiar. Los fallos y las paradas son constantes; la memoria todavía no es un criterio útil.'
    },
    {
      min: 15,
      max: 29,
      title: 'Leída',
      text: 'Ya conoces el texto y puedes avanzar por la partitura, pero tocar de principio a fin exige muchas paradas, repeticiones o simplificaciones. Hay numerosos pasajes que aún no salen, el tempo está lejos del definitivo y la memoria es inexistente o muy fragmentaria. Necesitas mirar la partitura casi todo el tiempo.'
    },
    {
      min: 30,
      max: 49,
      title: 'Digitada · en construcción',
      text: 'La digitación y la mecánica básica están bastante decididas. Puedes tocar secciones grandes y reconoces claramente la obra, pero todavía fallas en muchos pasajes, pierdes continuidad y debes trabajar despacio o por fragmentos. Puede haber memoria parcial, aunque sigues consultando con frecuencia. La obra aún se siente como algo que estás construyendo.'
    },
    {
      min: 50,
      max: 64,
      title: 'Aprendida',
      text: 'La obra ya está aprendida en sentido práctico: puedes recorrer casi todo el texto y sabes qué tienes que hacer en cada zona. Aun así hay bastantes errores técnicos, pasajes que no responden al tempo, interrupciones y posibles baches de memoria que te obligan a consultar. Podrías tocarla entera en condiciones cómodas, pero todavía no transmite sensación de seguridad.'
    },
    {
      min: 65,
      max: 79,
      title: 'Memorizada · asentando',
      text: 'Puedes tocar la obra de arriba abajo, normalmente de memoria, y mantener una continuidad reconocible. Puede haber algunos baches de memoria o puntos donde necesitas rescatarte o consultar; además todavía fallas en varios pasajes y estás puliendo problemas concretos que se repiten. La obra está claramente en tus manos, pero no está todavía a prueba de un mal día. Una obra memorizada que puedes tocar completa aunque tenga bastantes fallos suele vivir alrededor de 70–75.'
    },
    {
      min: 80,
      max: 89,
      title: 'A punto',
      text: 'La memoria es segura y la obra funciona casi siempre de principio a fin. La mayoría de los pasajes difíciles están resueltos; quedan errores locales, pequeñas irregularidades o uno o dos puntos que todavía requieren atención. Podrías tocarla para alguien con confianza razonable y recuperar un fallo sin que la ejecución se desmonte. Falta sobre todo consolidación y repetición estable.'
    },
    {
      min: 90,
      max: 96,
      title: 'Nivel concierto',
      text: 'La obra es estable en pases completos y bajo una presión parecida a tocar en público. La memoria sobrevive a distracciones y nervios, la recuperación tras un error es automática y la densidad de fallos es baja. Ya puedes dedicar gran parte de la atención al sonido, al fraseo y a la comunicación, en vez de a conseguir que las notas salgan.'
    },
    {
      min: 97,
      max: 100,
      title: 'Excelente · excepcionalmente sólida',
      text: 'La obra ha demostrado una robustez extraordinaria en pases repetidos y en situaciones exigentes. Apenas quedan incertidumbres técnicas o de memoria conocidas, y un pequeño accidente no compromete el conjunto. 100 no significa perfección humana: significa que, hoy, no identificas prácticamente ningún punto débil que necesite preparación adicional. Debe ser un estado raro.'
    }
  ];

  function ratingValueFromSlider(slider) {
    const semantic = Number(slider && slider.dataset && slider.dataset.paseValue);
    if (Number.isFinite(semantic) && semantic >= 1) return semantic;
    if (typeof window.pasePositionToPct === 'function' && slider) {
      const mapped = Number(window.pasePositionToPct(slider.value));
      if (Number.isFinite(mapped)) return mapped;
    }
    return Number(slider && slider.value) || 50;
  }

  function updateGuideCurrentRange(guide, slider) {
    if (!guide) return;
    const value = ratingValueFromSlider(slider);
    guide.querySelectorAll('[data-rating-min]').forEach(row => {
      const min = Number(row.dataset.ratingMin);
      const max = Number(row.dataset.ratingMax);
      const current = value >= min && value <= max;
      row.classList.toggle('is-current', current);
      if (current) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    });
  }

  function buildRatingGuide() {
    const anchor = document.getElementById('hechoSolidezSelection');
    if (!anchor || document.getElementById('hechoRatingGuide')) return;

    const guide = document.createElement('details');
    guide.id = 'hechoRatingGuide';
    guide.className = 'hecho-rating-guide';
    guide.innerHTML = [
      '<summary><span>¿Qué significa cada rango?</span><small>Guía orientativa · no es una lista de requisitos</small></summary>',
      '<div class="hecho-rating-guide-intro">El número describe tu sensación global de solidez <strong>hoy</strong>. La escala es deliberadamente exigente arriba: pasar de 80 a 90 representa mucho más progreso que pasar de 30 a 40. No hace falta cumplir literalmente cada frase; elige el rango que más se parezca al estado real de la obra.</div>',
      '<div class="hecho-rating-guide-list">',
      RATING_RANGES.map(range => (
        '<div class="hecho-rating-guide-row" data-rating-min="' + range.min + '" data-rating-max="' + range.max + '">' +
          '<div class="hecho-rating-guide-range"><strong>' + range.min + '–' + range.max + '</strong><span>' + range.title + '</span></div>' +
          '<p>' + range.text + '</p>' +
        '</div>'
      )).join(''),
      '</div>',
      '<div class="hecho-rating-guide-note"><strong>Importante:</strong> haberla tocado ya en concierto aporta evidencia de estabilidad, pero no es un requisito mecánico para asignar un número alto. Valora cómo responde realmente la obra.</div>'
    ].join('');

    anchor.insertAdjacentElement('afterend', guide);
    const slider = document.getElementById('hechoSolidezSlider');
    if (slider) {
      const refresh = () => updateGuideCurrentRange(guide, slider);
      slider.addEventListener('input', refresh);
      slider.addEventListener('change', refresh);
      try {
        new MutationObserver(refresh).observe(slider, { attributes: true, attributeFilter: ['data-pase-value', 'value'] });
      } catch (error) {}
      refresh();
    }
  }

  window.CronoLastStudyTarget = {
    key: LAST_TARGET_KEY,
    read: readLastTarget,
    write: writeLastTarget,
    resolveForSelect: exactLastTargetForSelect
  };

  installExactLastTargetBehavior();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildRatingGuide, { once: true });
  else buildRatingGuide();
}());
