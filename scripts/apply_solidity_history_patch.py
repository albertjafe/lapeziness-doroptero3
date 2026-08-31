from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'{label}: source snippet not found')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# ── SolidityModel: local-neighbour anomaly detection ──────────────────────────
model_path = Path('solidity-model.js')
model = model_path.read_text(encoding='utf-8')
if 'function detectOutliers(points, options)' not in model:
    insertion = r'''
  function median(values) {
    const sorted = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // Señala saltos aislados para revisión humana. Nunca corrige automáticamente.
  // Se compara cada medición solo con vecinos del mismo ámbito (obra/movimiento),
  // para no confundir diferencias normales entre movimientos con errores de entrada.
  function detectOutliers(points, options) {
    const opts = options || {};
    const radius = Math.max(1, Math.floor(Number(opts.neighborRadius) || 2));
    const minNeighbors = Math.max(2, Math.floor(Number(opts.minNeighbors) || 2));
    const minDelta = Math.max(1, Number(opts.minDelta) || 18);
    const spreadMultiplier = Math.max(0, Number(opts.spreadMultiplier) || 2.2);
    const spreadPadding = Math.max(0, Number(opts.spreadPadding) || 6);
    const groups = new Map();

    (Array.isArray(points) ? points : []).forEach((point, index) => {
      const rawSource = point && point.raw;
      const score = rawSource ? scoreFromObservation(rawSource) : percent(point && point.score);
      const time = point && point.time != null ? Number(point.time) : dateFrom(point);
      if (score == null || !Number.isFinite(time)) return;
      const normalized = Object.assign({}, point, { score, time, _index: index });
      const key = targetKey(normalized);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(normalized);
    });

    const flagged = [];
    groups.forEach(list => {
      list.sort((a, b) => a.time - b.time || a._index - b._index);
      list.forEach((point, index) => {
        const before = list.slice(Math.max(0, index - radius), index);
        const after = list.slice(index + 1, index + 1 + radius);
        const neighbors = before.concat(after);
        if (neighbors.length < minNeighbors) return;
        const scores = neighbors.map(item => item.score);
        const baseline = median(scores);
        if (baseline == null) return;
        const spread = Math.max(...scores) - Math.min(...scores);
        const threshold = Math.max(minDelta, spread * spreadMultiplier + spreadPadding);
        const delta = Math.abs(point.score - baseline);
        if (delta < threshold) return;
        flagged.push({
          point,
          score: point.score,
          baseline,
          delta,
          threshold,
          neighborScores: scores.slice(),
          target: targetKey(point),
        });
      });
    });
    return flagged.sort((a, b) => a.point._index - b.point._index);
  }

'''
    marker = '  return {\n'
    pos = model.rfind(marker)
    if pos < 0:
      raise SystemExit('solidity model return marker missing')
    model = model[:pos] + insertion + model[pos:]
    export_marker = '    inferredCoverage,\n    plateauGroups,\n'
    if export_marker not in model:
      raise SystemExit('solidity model export marker missing')
    model = model.replace(export_marker, '    inferredCoverage,\n    detectOutliers,\n    plateauGroups,\n', 1)
    model_path.write_text(model, encoding='utf-8')


# ── Unit tests for anomalies ──────────────────────────────────────────────────
test_path = Path('tests/unit/solidity-model.test.js')
test_text = test_path.read_text(encoding='utf-8')
if "flags an isolated historical solidity spike" not in test_text:
    tests = r'''

  it('flags an isolated historical solidity spike without changing it', () => {
    const points = [51, 52, 51, 90].map((score, index) => ({
      rowId: `r${index}`,
      score,
      time: Date.UTC(2026, 7, 27 + index),
      scope: 'whole',
    }));
    const flagged = Solidity.detectOutliers(points);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].point.rowId).toBe('r3');
    expect(flagged[0].score).toBe(90);
    expect(Math.round(flagged[0].baseline)).toBe(52);
  });

  it('flags a middle spike when both surrounding readings agree', () => {
    const points = [51, 90, 52].map((score, index) => ({
      rowId: `r${index}`,
      score,
      time: Date.UTC(2026, 7, 27 + index),
      scope: 'whole',
    }));
    const flagged = Solidity.detectOutliers(points);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].point.rowId).toBe('r1');
  });

  it('does not flag gradual improvement as an anomaly', () => {
    const points = [50, 60, 70, 80].map((score, index) => ({
      score,
      time: Date.UTC(2026, 7, 27 + index),
      scope: 'whole',
    }));
    expect(Solidity.detectOutliers(points)).toEqual([]);
  });

  it('never compares one movement against another movement to find anomalies', () => {
    const points = [
      { rowId: 'a1', score: 50, time: 1, scope: 'movement', movementId: 'a' },
      { rowId: 'a2', score: 51, time: 2, scope: 'movement', movementId: 'a' },
      { rowId: 'b1', score: 92, time: 1, scope: 'movement', movementId: 'b' },
      { rowId: 'b2', score: 93, time: 2, scope: 'movement', movementId: 'b' },
    ];
    expect(Solidity.detectOutliers(points)).toEqual([]);
  });
'''
    pos = test_text.rfind('\n});')
    if pos < 0:
      raise SystemExit('solidity unit test closing marker missing')
    test_path.write_text(test_text[:pos] + tests + test_text[pos:], encoding='utf-8')


# ── Premium work sheet integration ────────────────────────────────────────────
premium_path = Path('obra-premium.js')
premium = premium_path.read_text(encoding='utf-8')
if 'paseLiquidDirectTouchScript' not in premium:
    marker = "  const originalOpenObraFocus = typeof window.openObraFocus === 'function' ? window.openObraFocus : null;\n"
    if marker not in premium:
      raise SystemExit('premium companion marker missing')
    companion = marker + r'''

  function ensureCompanionScript(id, src) {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
  }

  // Carga ligera y global: seguimiento 1:1 del dedo y editor histórico.
  ensureCompanionScript('paseLiquidDirectTouchScript', './pase-liquid-direct-touch.js?v=1');
  ensureCompanionScript('solidityHistoryEditorScript', './solidity-history-editor.js?v=1');
'''
    premium = premium.replace(marker, companion, 1)

if 'data-action="solidity-history"' not in premium:
    marker = '''        </div>\n        <section class="obra-premium-section">\n          <div class="obra-premium-section-head">\n            <div class="obra-premium-section-title">Movimientos</div>'''
    if marker not in premium:
      raise SystemExit('premium history section marker missing')
    replacement = '''        </div>\n        <section class="obra-premium-section">\n          <div class="obra-premium-section-head">\n            <div class="obra-premium-section-title">Historial de solidez</div>\n            <button type="button" class="obra-premium-enrich" data-action="solidity-history">Revisar historial</button>\n          </div>\n          <div class="obra-premium-edit-note">Consulta todas las píldoras de la obra y sus movimientos, detecta saltos extraños y corrige un registro histórico concreto.</div>\n        </section>\n        <section class="obra-premium-section">\n          <div class="obra-premium-section-head">\n            <div class="obra-premium-section-title">Movimientos</div>'''
    premium = premium.replace(marker, replacement, 1)

if "if (action === 'solidity-history')" not in premium:
    marker = "        if (action === 'advanced') {\n"
    if marker not in premium:
      raise SystemExit('premium action marker missing')
    replacement = r'''        if (action === 'solidity-history') {
          const id = state.id;
          if (window.SolidityHistoryEditor && typeof window.SolidityHistoryEditor.open === 'function') {
            window.SolidityHistoryEditor.open(id);
          } else {
            state.message = 'Preparando el historial de solidez…';
            render();
            window.addEventListener('solidity-history-editor-ready', () => {
              if (window.SolidityHistoryEditor && typeof window.SolidityHistoryEditor.open === 'function') {
                window.SolidityHistoryEditor.open(id);
              }
            }, { once: true });
          }
        }
''' + marker
    premium = premium.replace(marker, replacement, 1)

if 'window.refreshPremiumWork' not in premium:
    marker = '  window.openPremiumWork = openPremium;\n  window.closePremiumWork = closePremium;\n'
    if marker not in premium:
      raise SystemExit('premium export marker missing')
    replacement = marker + "  window.refreshPremiumWork = function () { if (state.id) render(); };\n"
    premium = premium.replace(marker, replacement, 1)

premium_path.write_text(premium, encoding='utf-8')


# ── Editor: do not rebuild DOM during every pointermove ───────────────────────
editor_path = Path('solidity-history-editor.js')
editor = editor_path.read_text(encoding='utf-8')
pattern = re.compile(r"  function updateRow\(id, value, source\) \{.*?\n  \}\n\n  function bind\(container\) \{", re.S)
replacement = r'''  function refreshDirtyFooter() {
    const dirtyCount = state.rows.filter(row => row.value !== row.originalValue).length;
    const message = document.querySelector('#solidityHistoryOverlay .solidity-history-message');
    if (message && !state.message) {
      message.textContent = dirtyCount
        ? `${dirtyCount} cambio${dirtyCount === 1 ? '' : 's'} sin guardar`
        : 'Toca cualquier punto de una píldora para ajustar el valor.';
      message.classList.remove('success');
    }
    const saveButton = document.querySelector('#solidityHistoryOverlay [data-history-save]');
    if (saveButton) {
      saveButton.disabled = !dirtyCount;
      saveButton.textContent = `Guardar cambios${dirtyCount ? ` (${dirtyCount})` : ''}`;
    }
  }

  function updateRow(id, value, source) {
    const row = rowById(id);
    if (!row) return;
    const next = clampPct(value, row.value);
    row.value = next;
    state.message = '';
    state.success = false;
    const element = document.querySelector(`[data-history-row="${CSS.escape(id)}"]`);
    if (!element) return;
    element.classList.toggle('is-dirty', row.value !== row.originalValue);
    const meter = element.querySelector('.solidity-history-pill');
    if (meter) meter.setAttribute('style', pillStyle(next));
    const slider = element.querySelector('[data-history-slider]');
    const number = element.querySelector('[data-history-number]');
    if (slider && source !== 'slider') slider.value = sliderPosition(next).toFixed(2);
    if (number && String(number.value) !== String(next)) number.value = String(next);
    if (slider) {
      slider.dataset.paseValue = String(next);
      slider.setAttribute('aria-valuetext', `${next} por ciento`);
    }
    refreshDirtyFooter();
  }

  function bind(container) {'''
editor, count = pattern.subn(replacement, editor, count=1)
if count != 1:
    raise SystemExit(f'editor updateRow patch expected 1 match, got {count}')
old_bind = """    container.querySelectorAll('[data-history-slider]').forEach(input => input.addEventListener('input', () => {\n      updateRow(input.dataset.historySlider, positionToPct(input.value), 'slider');\n    }));\n    container.querySelectorAll('[data-history-number]').forEach(input => {\n      input.addEventListener('change', () => updateRow(input.dataset.historyNumber, input.value, 'number'));\n"""
new_bind = """    container.querySelectorAll('[data-history-slider]').forEach(input => {\n      input.addEventListener('input', () => updateRow(input.dataset.historySlider, positionToPct(input.value), 'slider'));\n      input.addEventListener('change', () => render());\n    });\n    container.querySelectorAll('[data-history-number]').forEach(input => {\n      input.addEventListener('change', () => {\n        updateRow(input.dataset.historyNumber, input.value, 'number');\n        render();\n      });\n"""
if old_bind not in editor:
    raise SystemExit('editor bind patch marker missing')
editor = editor.replace(old_bind, new_bind, 1)
editor_path.write_text(editor, encoding='utf-8')
