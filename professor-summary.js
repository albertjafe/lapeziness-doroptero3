(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorSummary = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /* Resumen legible del Profesor. El anexo V4 conserva todo el historial sin
     pérdida, pero en varios MB de tablas codificadas un modelo lee una parte y
     supone el resto. Este resumen se calcula del MISMO informe deduplicado, en
     español llano y con los huecos de datos declarados: es lo que manda. */

  const arr = value => Array.isArray(value) ? value : [];
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const DAY = 86400000;
  const STALE_EVIDENCE_DAYS = 30;
  const RECENT_DAYS = 14;
  const MAX_AGENDA = 6;

  function dayKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function shiftDay(key, offset) {
    const [y, m, d] = String(key).split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + offset, 12));
  }
  function hm(minutes) {
    const m = Math.round(num(minutes));
    if (!m) return '0 min';
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
  }
  const hours = minutes => (Math.round(num(minutes) / 6) / 10).toString().replace('.', ',') + ' h';
  const dec = value => String(Math.round(num(value) * 10) / 10).replace('.', ',');
  const clean = text => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const euro = value => num(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  function unitName(unit) {
    return (unit.composer ? unit.composer + ' · ' : '') + (unit.label || unit.work || unit.key);
  }

  function eventWhen(event) {
    if (!event) return '';
    if (event.daysAway == null) return 'sin fecha';
    if (event.datePrecision === 'month') return `mes ${event.targetMonth} (≈${event.daysAway} d)`;
    return `${event.day} (en ${event.daysAway} d)`;
  }

  function unitLine(unit) {
    const parts = [];
    if (unit.solidity == null) parts.push('solidez SIN MEDIR');
    else {
      const age = unit.daysSinceEvidence == null ? 'sin fecha de medida' : `medida hace ${Math.round(unit.daysSinceEvidence)} d`;
      parts.push(`solidez ${Math.round(unit.solidity)} % (${age})`);
    }
    parts.push(unit.difficulty == null ? 'dificultad sin indicar' : `dificultad ${dec(unit.difficulty)}/10`);
    const r = unit.recent || {};
    parts.push(`hoy ${hm(r.today)} · 7 d ${hours(r.d7)} · 30 d ${hours(r.d30)}`);
    parts.push(unit.lastStudyAt ? `última práctica hace ${Math.floor(num(unit.daysSinceStudy))} d` : 'sin práctica registrada');
    if (unit.historicalWorkHours) parts.push(`familiaridad histórica de la obra ${dec(unit.historicalWorkHours)} h`);
    if (unit.nextEvent) parts.push(`para: ${unit.nextEvent.name} · ${eventWhen(unit.nextEvent)}`);
    if (unit.recoveryHours) parts.push(`estimación hasta objetivo ${dec(unit.recoveryHours.low)}–${dec(unit.recoveryHours.high)} h`);
    if (unit.priority) parts.push(`prioridad calculada ${unit.priority.band}: ${arr(unit.priority.reasons).join(', ')}`);
    return `- ${unitName(unit)} | ${parts.join(' | ')}`;
  }

  function todaySection(report, byKey) {
    const t = report.today || {};
    const lines = [`HOY ${report.day || dayKey(report.asOf)}: ${hm(t.totalKnownMinutes)} estudiados en total.`];
    arr(t.byUnit).forEach(item => lines.push(`- ${byKey.get(item.key) ? unitName(byKey.get(item.key)) : item.label}: ${hm(item.minutes)}`));
    if (num(t.unallocatedMinutes)) lines.push(`- Sin movimiento asignado: ${hm(t.unallocatedMinutes)} (no los repartas entre movimientos).`);
    if (num(t.activeUnsavedMinutes)) lines.push(`- Incluye ${hm(t.activeUnsavedMinutes)} de la sesión en curso, aún sin guardar.`);
    return lines.join('\n');
  }

  function recentSection(report, byWork) {
    const today = report.day || dayKey(report.asOf);
    const days = new Map(arr(report.recentStudyDays).map(d => [d.day, d]));
    const rows = [];
    let total = 0, empty = 0;
    for (let i = 1; i <= RECENT_DAYS; i++) {
      const key = shiftDay(today, -i), day = days.get(key);
      const minutes = num(day && day.totalMinutes);
      total += minutes; if (!minutes) empty++;
      const top = day ? arr(day.byUnit).slice().sort((a, b) => b.minutes - a.minutes).slice(0, 3)
        .map(u => `${byWork(u.obraId, u.movId)} ${hm(u.minutes)}`).join('; ') : '';
      if (minutes) rows.push(`- ${key}: ${hm(minutes)}${top ? ' · ' + top : ''}`);
    }
    return [`ÚLTIMOS ${RECENT_DAYS} DÍAS (sin hoy): media ${hm(total / RECENT_DAYS)}/día; ${empty} día(s) sin estudio${rows.length ? '; días con estudio:' : '.'}`, ...rows].join('\n');
  }

  function agendaSection(report) {
    const events = arr(report.events);
    const linked = events.filter(e => e.repertoireLinked);
    const projects = events.filter(e => e.type === 'proyecto' && !e.repertoireLinked);
    const other = events.filter(e => !e.repertoireLinked && e.type !== 'proyecto');
    const works = new Map(arr(report.works).map(w => [String(w.id), w.name]));
    const lines = ['COMPROMISOS CON REPERTORIO (los únicos que crean urgencia musical):'];
    if (!linked.length) lines.push('- Ninguno.');
    linked.forEach(e => lines.push(`- ${e.name}${e.type ? ' (' + e.type + ')' : ''} · ${eventWhen(e)} · obras: ${arr(e.workIds).map(id => works.get(id) || id).join(', ')}`));
    if (projects.length) {
      lines.push('PROYECTOS PERSONALES (trabajo válido, sin urgencia ni plazo inventado):');
      projects.forEach(e => lines.push(`- ${e.name} · ${e.progress == null ? 'progreso sin indicar' : 'progreso ' + e.progress + ' %'}${e.status ? ' · ' + e.status : ''} · ${eventWhen(e)}`));
    }
    if (other.length) {
      const soon = other.filter(e => e.daysAway != null && e.daysAway <= RECENT_DAYS).slice(0, MAX_AGENDA);
      lines.push(`AGENDA SIN REPERTORIO: ${other.length} evento(s) (concursos precargados, calendario…). No crean prioridad musical; solo informan de disponibilidad.`);
      soon.forEach(e => lines.push(`- ${e.name} · ${eventWhen(e)}${e.source === 'google' ? ' · Google Calendar' : ''}`));
      if (other.length > soon.length) lines.push(`- (+${other.length - soon.length} más, detalle en el anexo)`);
    }
    return lines.join('\n');
  }

  function tasksSection(report) {
    const today = report.day || dayKey(report.asOf);
    const labels = ['normal', 'importante', 'urgente', 'urgentísima'];
    const open = arr(report.sourceContext && report.sourceContext.tasks).filter(t => t && !t.done && !t.deleted && clean(t.text))
      .sort((a, b) => num(b.priority) - num(a.priority) || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')));
    if (!open.length) return 'TAREAS PENDIENTES: ninguna.';
    return ['TAREAS PENDIENTES:', ...open.slice(0, 20).map(t => {
      const due = t.dueDate ? (t.dueDate < today ? `vencida ${t.dueDate}` : t.dueDate === today ? 'hoy' : t.dueDate) : '';
      const work = t.obraName ? ` · ${t.obraName}${t.obraSubName ? ' · ' + t.obraSubName : ''}` : '';
      return `- [${labels[Math.max(0, Math.min(3, Math.round(num(t.priority))))]}${t.kind === 'personal' ? ', personal' : ''}] ${clean(t.text)}${work}${due ? ' · ' + due : ''}`;
    }), ...(open.length > 20 ? [`- (+${open.length - 20} más en el anexo)`] : [])].join('\n');
  }

  function availabilitySection(report) {
    const today = report.day || dayKey(report.asOf);
    const blocked = arr(report.sourceContext && report.sourceContext.blockedDaySchedules).find(d => d && d.date === today);
    const lines = [];
    if (blocked && arr(blocked.blocks).length) lines.push('HORAS OCUPADAS HOY: ' + blocked.blocks.map(b => `${b.start}–${b.end}`).join(', '));
    const state = report.dailyState;
    if (state && state.available) {
      const bits = [['sueño', state.sleepScore], ['ánimo', state.moodScore], ['energía', state.energyScore], ['claridad', state.clarityScore], ['bienestar', state.wellbeingScore]]
        .filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`);
      lines.push(`ESTADO DE HOY${state.userSet || state.sleepUserSet ? '' : ' (valores automáticos, no declarados)'}: ${bits.join(', ') || 'sin datos'}.`);
    }
    return lines.join('\n');
  }

  function habitsSection(habits) {
    const list = arr(habits);
    if (!list.length) return 'HÁBITOS: ninguno registrado.';
    const lines = ['HÁBITOS (reglas que me he puesto; respétalas al planificar):'];
    list.forEach(h => {
      const head = `- ${h.title} · ${h.mode === 'avoid' ? 'EVITAR' : 'HACER'} · ${h.status === 'complete' ? 'TERMINADO ' + (h.completedOn || '') : h.status === 'planned' ? 'empieza ' + h.startDate : `día ${h.day}/${h.durationDays}`}`;
      const stats = `cumplidos ${h.success} · fallos ${h.failure}${h.status === 'active' ? ` · racha ${h.streak} · hoy ${h.today}` : ` · cumplimiento ${h.compliance} %`}`;
      lines.push(head + ' · ' + stats);
      if (h.description) lines.push(`  descripción: ${clean(h.description)}`);
      if (h.successCriteria) lines.push(`  cuenta como cumplido: ${clean(h.successCriteria)}`);
      if (h.motivation) lines.push(`  motivo: ${clean(h.motivation)}`);
      if (h.reward) lines.push(`  recompensa elegida: ${clean(h.reward)}`);
      if (h.effortPoints != null) lines.push(`  premio de esfuerzo: ${h.effortPoints} puntos${h.effortStatus ? ' (' + h.effortStatus + ')' : ''}`);
    });
    return lines.join('\n');
  }

  function rewardsSection(rewards) {
    if (!rewards || !rewards.available) return '';
    const lines = ['PREMIOS Y DINERO (motivación; no cambian qué es musicalmente urgente):'];
    const s = rewards.streak;
    if (s) lines.push(`- Racha de días completos (≥4 h): ${s.current} día(s)${s.frozen ? `, congelada; quedan ${s.graceDaysLeft} día(s) para salvarla` : ''}${s.fullDay ? '; hoy ya es día completo' : `; hoy lleva ${hm(num(s.todaySeconds) / 60)} de 4 h`}.`);
    if (rewards.activeGoal) lines.push(`- Objetivo de compra activo: ${rewards.activeGoal.name} · ${euro(rewards.activeGoal.saved)} de ${euro(rewards.activeGoal.amount)} (${Math.round(num(rewards.activeGoal.percent))} %).`);
    arr(rewards.openGoals).filter(g => !rewards.activeGoal || g.id !== rewards.activeGoal.id).forEach(g => lines.push(`- Otro objetivo abierto: ${g.name} · ${euro(g.amount)}`));
    arr(rewards.redeemed).forEach(r => lines.push(`- Conseguido: ${r.name} · ${euro(r.amount)} · ${r.date}`));
    const earned = arr(rewards.achievements).filter(a => a.earned);
    if (earned.length) lines.push(`- Logros: ${earned.map(a => a.name + (a.date ? ' (' + a.date + ')' : '')).join('; ')}`);
    return lines.join('\n');
  }

  function qualitySection(report, units) {
    const lines = [];
    const unmeasured = units.filter(u => u.solidity == null);
    const stale = units.filter(u => u.solidity != null && (u.daysSinceEvidence == null || u.daysSinceEvidence > STALE_EVIDENCE_DAYS));
    const noDifficulty = units.filter(u => u.difficulty == null);
    const linkedCold = units.filter(u => u.nextEvent && u.nextEvent.daysAway != null && u.nextEvent.daysAway <= 30 && (u.solidity == null || u.daysSinceEvidence == null || u.daysSinceEvidence > 14));
    const list = items => items.slice(0, 8).map(unitName).join('; ') + (items.length > 8 ? `; +${items.length - 8}` : '');
    if (unmeasured.length) lines.push(`- ${unmeasured.length} unidad(es) sin ninguna medida de solidez: ${list(unmeasured)}. Su estado es DESCONOCIDO, no bajo.`);
    if (stale.length) lines.push(`- ${stale.length} unidad(es) con la última medida de hace más de ${STALE_EVIDENCE_DAYS} días: ${list(stale)}.`);
    if (linkedCold.length) lines.push(`- Con compromiso en ≤30 días y sin medida reciente: ${list(linkedCold)}. Si puedes, propón medirlas (un pase en frío).`);
    if (noDifficulty.length) lines.push(`- ${noDifficulty.length} unidad(es) sin dificultad indicada (se estima como 5/10).`);
    if (num(report.today && report.today.unallocatedMinutes)) lines.push(`- Parte del estudio de hoy no tiene movimiento asignado.`);
    if (report.digitalActivity && report.digitalActivity.available === false) lines.push('- Actividad digital no disponible en este informe.');
    return ['CALIDAD DE LOS DATOS (dónde no fiarte):', ...(lines.length ? lines : ['- Sin huecos relevantes detectados.'])].join('\n');
  }

  function buildSummary(report) {
    const r = report || {};
    const units = arr(r.units);
    const byKey = new Map(units.map(u => [u.key, u]));
    const workNames = new Map(arr(r.works).map(w => [String(w.id), w.name]));
    const byWork = (obraId, movId) => {
      const unit = byKey.get(movId ? `${obraId}::${movId}` : String(obraId));
      return unit ? unit.label : (workNames.get(String(obraId)) || (obraId ? 'obra ' + obraId : 'sin obra'));
    };
    const rep = units.length
      ? ['REPERTORIO (una línea por movimiento u obra, de más a menos prioritaria según la app):', ...units.map(unitLine)].join('\n')
      : 'REPERTORIO: no hay obras registradas.';
    return [
      'RESUMEN_FIABLE',
      'Este resumen está calculado a partir del anexo, ya deduplicado. MANDA sobre el anexo: úsalo para decidir. Consulta el anexo solo para un detalle concreto; si algo parece contradecirse, cree al resumen.',
      todaySection(r, byKey),
      recentSection(r, byWork),
      rep,
      agendaSection(r),
      tasksSection(r),
      availabilitySection(r),
      habitsSection(r.habits),
      rewardsSection(r.rewards),
      qualitySection(r, units),
      'FIN_RESUMEN_FIABLE',
    ].filter(Boolean).join('\n\n');
  }

  /* Datos del lado de la interfaz (hábitos y premios necesitan módulos que el
     worker no carga). Solo lectura: se calculan sobre una copia. */
  function habitsFor(data, now, trophies) {
    const T = trophies || root.HabitTrophies;
    const list = arr(data && data.habitChallenges).concat(data && data.habitChallenge ? [data.habitChallenge] : []);
    const seen = new Set();
    return list.filter(h => h && h.id && !h.deleted && !seen.has(h.id) && seen.add(h.id)).map(h => {
      const item = T ? T.itemFor(h, now) : null;
      const reward = T && h.effortReward ? T.rewardStatus(h, now) : null;
      const logs = h.logs || {}, today = dayKey(now), duration = item ? item.duration : num(h.durationDays, 21);
      let streak = 0;
      if (item && item.status === 'active') {
        const index = Math.round((new Date(today + 'T12:00:00') - new Date(h.startDate + 'T12:00:00')) / DAY);
        for (let i = 0; i < index; i++) {
          const status = typeof logs[shiftDay(h.startDate, i)] === 'string' ? logs[shiftDay(h.startDate, i)] : (logs[shiftDay(h.startDate, i)] || {}).status;
          const ok = h.mode === 'avoid' ? status !== 'failed' : status === 'done';
          streak = ok ? streak + 1 : 0;
        }
      }
      const todayStatus = typeof logs[today] === 'string' ? logs[today] : (logs[today] || {}).status;
      return {
        id: h.id, title: clean(h.title) || 'Hábito', mode: h.mode === 'avoid' ? 'avoid' : 'do',
        description: h.description || '', motivation: h.motivation || '', successCriteria: h.successCriteria || '', reward: h.reward || '',
        startDate: h.startDate, durationDays: duration, status: item ? item.status : 'unknown', completedOn: item && item.completedOn,
        day: item ? Math.max(1, item.elapsed) : null, success: item ? item.success : 0, failure: item ? item.failure : 0,
        compliance: item ? item.compliance : 0, streak,
        today: h.mode === 'avoid' ? (todayStatus === 'failed' ? 'incumplido' : 'sin recaída') : (todayStatus === 'done' ? 'cumplido' : 'pendiente'),
        effortPoints: reward && reward.status !== 'none' ? (reward.status === 'earned' ? reward.points : reward.potentialPoints) : null,
        effortStatus: reward && reward.status !== 'none' ? ({ earned: 'ganado', active: 'en juego', failed: 'perdido' }[reward.status] || reward.status) : null,
      };
    });
  }

  function rewardsFor(data, now, api) {
    const P = api || root.PianoRewards, A = root.AchievementRewards;
    if (!P || !data) return { available: false };
    try {
      const copy = JSON.parse(JSON.stringify(data));
      const today = P.dayKey(now);
      const state = P.studyState(copy, today);
      const snap = P.walletSnapshot(copy);
      const goal = P.activeGoal(copy);
      const progress = goal ? P.goalProgressFromWallet(goal, snap.rows, snap.wallet) : null;
      const achievements = A ? A.achievements(copy, P.lifetimeMinutes(copy, today), today) : [];
      return {
        available: true,
        streak: P.streakStats(state.sessions, today),
        points: snap.points,
        activeGoal: goal ? { id: goal.id, name: goal.name, amount: goal.amount, saved: progress ? progress.amount : 0, percent: progress ? progress.percent : 0 } : null,
        openGoals: arr(snap.goals).filter(g => g && !g.archivedAt && !g.deletedAt).map(g => ({ id: g.id, name: g.name, amount: g.amount })),
        redeemed: arr(snap.wallet && snap.wallet.redemptions).map(r => ({ name: r.goalName, amount: r.amount, date: dayKey(r.createdAt) })),
        achievements: arr(achievements).map(a => ({ id: a.id, name: a.name || a.title || a.id, earned: !!a.earned, date: a.date || null, paid: !!a.paid })),
      };
    } catch (error) {
      return { available: false, error: String(error && error.message || error) };
    }
  }

  // Todo lo que el informe no incluye ya en sourceContext: el anexo es el
  // documento completo. Solo se quitan metadatos internos de sincronización.
  const REPORTED_KEYS = new Set(['sesiones', 'sessionPlants', 'forestPlants', 'eventos', 'competitionPlans', 'cronoTasks',
    'weeklyPlans', 'blockedDaySchedules', 'tiempoDisponibleEventos', 'registro', 'passageTracker', 'historicalRepertoire', 'historicalEvents', 'obras']);
  function otherHistory(data) {
    const out = {};
    Object.keys(data || {}).forEach(key => {
      if (key.startsWith('_') || REPORTED_KEYS.has(key)) return;
      out[key] = data[key];
    });
    return out;
  }

  return { buildSummary, habitsFor, rewardsFor, otherHistory, unitLine };
});
