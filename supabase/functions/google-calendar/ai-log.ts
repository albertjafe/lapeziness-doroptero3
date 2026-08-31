import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const AI_LOG_TITLE = "Alberto — AI Activity Log";
const AI_LOG_TABS = ["Resumen", "Estudio", "Comentarios", "Tareas", "Objetivos", "Eventos"];
const DAY_MS = 24 * 60 * 60 * 1000;

async function googleJson(url: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error_description || "Google request failed");
  return payload;
}

function civilDayOrdinal(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const check = new Date(timestamp);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return Math.floor(timestamp / DAY_MS);
}

function civilDayFromOrdinal(ordinal: number | null) {
  if (ordinal == null || !Number.isFinite(ordinal)) return null;
  return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
}

function dayInMadrid(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timeInMadrid(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function habitLogStatus(log: any) {
  return String(log?.status || "").trim().toLowerCase();
}

function isFailureLog(log: any) {
  const status = habitLogStatus(log);
  return !status || ["failed", "fail", "failure", "relapse", "broken", "missed"].includes(status);
}

function isDoneLog(log: any) {
  return ["done", "success", "succeeded", "complete", "completed"].includes(habitLogStatus(log));
}

function summarizeHabit(habit: any, todayDay: string) {
  if (!habit?.id) return null;
  const mode = String(habit.mode || "").trim().toLowerCase();
  const startOrdinal = civilDayOrdinal(habit.startDate);
  const todayOrdinal = civilDayOrdinal(todayDay);
  const durationDays = Math.max(1, Math.floor(Number(habit.durationDays) || 1));
  const completionOrdinal = startOrdinal == null ? null : startOrdinal + durationDays - 1;

  let phase = "unknown";
  let currentDay = 0;
  let closedDays = 0;
  if (habit.deleted) {
    phase = "deleted";
  } else if (startOrdinal != null && todayOrdinal != null) {
    if (todayOrdinal < startOrdinal) phase = "scheduled";
    else if (completionOrdinal != null && todayOrdinal <= completionOrdinal) {
      phase = "active";
      currentDay = Math.min(durationDays, todayOrdinal - startOrdinal + 1);
      closedDays = Math.min(durationDays, Math.max(0, todayOrdinal - startOrdinal));
    } else {
      phase = "maintenance";
      currentDay = durationDays;
      closedDays = durationDays;
    }
  }

  const failureDays = new Set<string>();
  const closedFailureDays = new Set<string>();
  const closedDoneDays = new Set<string>();
  Object.entries(habit.logs || {}).forEach(([day, log]) => {
    const ordinal = civilDayOrdinal(day);
    if (ordinal == null || startOrdinal == null || todayOrdinal == null || completionOrdinal == null) return;
    if (ordinal < startOrdinal || ordinal > completionOrdinal || ordinal > todayOrdinal) return;
    if (isFailureLog(log)) {
      failureDays.add(day);
      if (ordinal < todayOrdinal) closedFailureDays.add(day);
    }
    if (ordinal < todayOrdinal && isDoneLog(log)) closedDoneDays.add(day);
  });

  const avoidMode = mode === "avoid";
  const successfulClosedDays = avoidMode
    ? Math.max(0, closedDays - closedFailureDays.size)
    : Math.min(closedDays, closedDoneDays.size);

  return {
    id: String(habit.id),
    title: String(habit.title || ""),
    mode,
    phase,
    startDate: String(habit.startDate || ""),
    completionDate: civilDayFromOrdinal(completionOrdinal) || "",
    durationDays,
    currentDay,
    successfulClosedDays,
    failureCount: failureDays.size,
    failureDays: Array.from(failureDays).sort().join(", "),
    successRule: avoidMode ? "Día cerrado sin registro de fallo = éxito" : "Día cerrado con registro done = éxito",
  };
}

function buildLookups(db: any) {
  const works = new Map<string, string>();
  const movements = new Map<string, { work: string; movement: string }>();
  (Array.isArray(db.obras) ? db.obras : []).forEach((obra: any) => {
    const workName = [obra?.name, obra?.composer].filter(Boolean).join(" · ") || String(obra?.id || "");
    if (obra?.id) works.set(String(obra.id), workName);
    (Array.isArray(obra?.movimientos) ? obra.movimientos : []).forEach((mov: any) => {
      if (mov?.id) movements.set(String(mov.id), {
        work: workName,
        movement: String(mov.name || mov.title || mov.id),
      });
    });
  });
  return { works, movements };
}

function pieceLabel(piece: any) {
  if (typeof piece === "string") return piece;
  if (!piece || typeof piece !== "object") return "";
  return String(piece.name || piece.title || piece.obraName || piece.label || piece.id || "");
}

function buildAiLog(db: any, dbUpdatedAt: string | null) {
  const today = dayInMadrid(new Date());
  const todayOrdinal = civilDayOrdinal(today) || 0;
  const { works, movements } = buildLookups(db);
  const plants = (Array.isArray(db.sessionPlants) ? db.sessionPlants : [])
    .filter((plant: any) => plant && plant.startedAt)
    .slice()
    .sort((a: any, b: any) => String(a.startedAt).localeCompare(String(b.startedAt)));

  const studyRows: any[][] = [["Fecha", "Inicio", "Fin", "Minutos", "Obra", "Movimiento", "Fuente", "ID"]];
  plants.forEach((plant: any) => {
    const movement = movements.get(String(plant.movId || ""));
    const work = movement?.work || works.get(String(plant.obraId || "")) || String(plant.obraId || plant.tag || "");
    studyRows.push([
      dayInMadrid(String(plant.startedAt || "")),
      timeInMadrid(String(plant.startedAt || "")),
      timeInMadrid(String(plant.endedAt || "")),
      Number(plant.mins || 0),
      work,
      movement?.movement || "",
      String(plant.source || "app"),
      String(plant.id || plant.runId || ""),
    ]);
  });

  const commentsRows: any[][] = [["Fecha", "Inicio", "Obra / movimiento", "Zona", "Objetivo", "Comentario", "Rating", "Minutos"]];
  (Array.isArray(db.sesiones) ? db.sesiones : []).slice().sort((a: any, b: any) =>
    String(a?.date || "").localeCompare(String(b?.date || ""))
  ).forEach((session: any) => {
    (Array.isArray(session?.items) ? session.items : []).forEach((item: any) => {
      const objective = String(item?.objetivo || "").trim();
      const note = String(item?.note || item?.ratingNota || item?.destelloNota || "").trim();
      if (!objective && !note) return;
      commentsRows.push([
        dayInMadrid(String(item?.startedAt || session?.date || "")),
        timeInMadrid(String(item?.startedAt || session?.date || "")),
        String(item?.obraName || ""),
        String(item?.zone?.summary || item?.zona || ""),
        objective,
        note,
        item?.rating ?? item?.solRating ?? "",
        Number(item?.minutosReales ?? item?.min ?? 0) || 0,
      ]);
    });
  });

  const tasks = (Array.isArray(db.cronoTasks) ? db.cronoTasks : []).slice().sort((a: any, b: any) =>
    String(a?.createdAt || "").localeCompare(String(b?.createdAt || ""))
  );
  const taskRows: any[][] = [["Creada", "Estado", "Tipo", "Prioridad", "Vence", "Tarea", "Obra", "Hecha", "Para mañana"]];
  tasks.forEach((task: any) => {
    taskRows.push([
      dayInMadrid(String(task?.createdAt || "")),
      task?.done ? "hecha" : "pendiente",
      String(task?.kind || ""),
      Number(task?.priority ?? 0),
      String(task?.dueDate || ""),
      String(task?.text || ""),
      String(task?.obraSubName || task?.obraName || ""),
      task?.doneAt ? dayInMadrid(String(task.doneAt)) : "",
      task?.tomorrow ? "sí" : "",
    ]);
  });

  const habitMap = new Map<string, any>();
  (Array.isArray(db.habitChallenges) ? db.habitChallenges : []).concat(db.habitChallenge ? [db.habitChallenge] : [])
    .forEach((habit: any) => {
      if (!habit?.id) return;
      const current = habitMap.get(String(habit.id));
      const currentAt = String(current?.updatedAt || current?.createdAt || "");
      const candidateAt = String(habit?.updatedAt || habit?.createdAt || "");
      if (!current || candidateAt.localeCompare(currentAt) >= 0) habitMap.set(String(habit.id), habit);
    });
  const habitSummaries = Array.from(habitMap.values())
    .map((habit: any) => summarizeHabit(habit, today))
    .filter(Boolean)
    .sort((a: any, b: any) => String(a.startDate).localeCompare(String(b.startDate)));
  const habitRows: any[][] = [[
    "Objetivo", "Modo", "Estado", "Inicio", "Fin", "Día", "Duración", "Días cerrados correctos", "Fallos", "Días de fallo", "Regla"
  ]];
  habitSummaries.forEach((habit: any) => {
    habitRows.push([
      habit.title, habit.mode, habit.phase, habit.startDate, habit.completionDate,
      habit.currentDay, habit.durationDays, habit.successfulClosedDays,
      habit.failureCount, habit.failureDays, habit.successRule,
    ]);
  });

  const eventRows: any[][] = [["Fecha", "Tipo", "Evento", "Estado", "Programa"]];
  (Array.isArray(db.eventos) ? db.eventos : []).slice().sort((a: any, b: any) =>
    String(a?.date || a?.fecha || "").localeCompare(String(b?.date || b?.fecha || ""))
  ).forEach((event: any) => {
    const pieces = event?.pieces || event?.obras || event?.program || [];
    eventRows.push([
      String(event?.date || event?.fecha || ""),
      String(event?.tipo || event?.type || ""),
      String(event?.name || event?.title || event?.nombre || ""),
      event?.completed === true ? "completado" : event?.completed === false ? "pendiente" : "",
      Array.isArray(pieces) ? pieces.map(pieceLabel).filter(Boolean).join(" | ") : pieceLabel(pieces),
    ]);
  });

  const minutesForDay = (targetDay: string) => plants
    .filter((plant: any) => dayInMadrid(String(plant.startedAt || "")) === targetDay)
    .reduce((sum: number, plant: any) => sum + (Number(plant.mins) || 0), 0);
  const minutesInWindow = (days: number) => plants.reduce((sum: number, plant: any) => {
    const ordinal = civilDayOrdinal(dayInMadrid(String(plant.startedAt || "")));
    return ordinal != null && ordinal >= todayOrdinal - (days - 1) && ordinal <= todayOrdinal
      ? sum + (Number(plant.mins) || 0)
      : sum;
  }, 0);

  const activeHabit = habitSummaries
    .filter((habit: any) => habit.phase === "active")
    .sort((a: any, b: any) => String(b.startDate).localeCompare(String(a.startDate)))[0] || null;
  const openTasks = tasks.filter((task: any) => !task?.done).length;
  const lastPlant = plants[plants.length - 1];
  const lastMovement = lastPlant ? movements.get(String(lastPlant.movId || "")) : null;
  const lastWork = lastPlant
    ? (lastMovement?.work || works.get(String(lastPlant.obraId || "")) || String(lastPlant.obraId || ""))
    : "";

  const summaryRows: any[][] = [
    ["Campo", "Valor"],
    ["Schema", "ai_activity_log_v1"],
    ["Actualizado", new Date().toISOString()],
    ["Datos de la app actualizados", dbUpdatedAt || ""],
    ["Fecha local", today],
    ["Estudio hoy (min)", minutesForDay(today)],
    ["Estudio últimos 7 días (min)", minutesInWindow(7)],
    ["Estudio últimos 30 días (min)", minutesInWindow(30)],
    ["Bloques de estudio exportados", plants.length],
    ["Último bloque", lastPlant ? `${lastWork}${lastMovement?.movement ? " · " + lastMovement.movement : ""} · ${Number(lastPlant.mins || 0)} min` : ""],
    ["Tareas pendientes", openTasks],
    ["Objetivo activo", activeHabit ? activeHabit.title : ""],
    ["Progreso objetivo activo", activeHabit ? `día ${activeHabit.currentDay}/${activeHabit.durationDays}; ${activeHabit.failureCount} fallos` : ""],
    ["Semántica objetivo avoid", "Un día cerrado sin registro de fallo cuenta como éxito."],
    ["Ámbito del log", "Estudio de piano, comentarios/objetivos de sesiones, tareas, hábitos/objetivos y eventos musicales."],
    ["Exclusiones deliberadas", "No exporta TOC/ROCD, estado de ánimo, impulsos, malestar, sueño, salud ni otros datos sensibles."],
  ];

  return {
    Resumen: summaryRows,
    Estudio: studyRows,
    Comentarios: commentsRows,
    Tareas: taskRows,
    Objetivos: habitRows,
    Eventos: eventRows,
  };
}

async function ensureSpreadsheet(
  admin: SupabaseClient,
  connection: any,
  userId: string,
  token: string,
) {
  if (connection?.ai_log_spreadsheet_id) return String(connection.ai_log_spreadsheet_id);
  const payload = await googleJson(GOOGLE_SHEETS_API, token, {
    method: "POST",
    body: JSON.stringify({
      properties: { title: AI_LOG_TITLE },
      sheets: AI_LOG_TABS.map(title => ({ properties: { title } })),
    }),
  });
  const spreadsheetId = String(payload.spreadsheetId || "");
  if (!spreadsheetId) throw new Error("Google Sheets no devolvió el ID del registro IA");
  const { error } = await admin.from("google_calendar_connections").update({
    ai_log_spreadsheet_id: spreadsheetId,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (error) throw error;
  connection.ai_log_spreadsheet_id = spreadsheetId;
  return spreadsheetId;
}

async function replaceSpreadsheet(spreadsheetId: string, token: string, tabs: Record<string, any[][]>) {
  await googleJson(`${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchClear`, token, {
    method: "POST",
    body: JSON.stringify({ ranges: AI_LOG_TABS.map(title => `${title}!A:Z`) }),
  });
  await googleJson(`${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: AI_LOG_TABS.map(title => ({
        range: `${title}!A1`,
        majorDimension: "ROWS",
        values: tabs[title] || [[]],
      })),
    }),
  });
}

export async function syncAiActivityLog(options: {
  admin: SupabaseClient;
  connection: any;
  userId: string;
  accessToken: string;
}) {
  const { admin, connection, userId, accessToken } = options;
  const spreadsheetId = await ensureSpreadsheet(admin, connection, userId, accessToken);
  const { data: row, error } = await admin.from("user_data")
    .select("data,updated_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row?.data) throw new Error("No hay datos de la app para exportar todavía");

  const tabs = buildAiLog(row.data, row.updated_at || null);
  await replaceSpreadsheet(spreadsheetId, accessToken, tabs);
  const syncedAt = new Date().toISOString();
  const { error: updateError } = await admin.from("google_calendar_connections").update({
    ai_log_synced_at: syncedAt,
    updated_at: syncedAt,
  }).eq("user_id", userId);
  if (updateError) throw updateError;

  return {
    syncedAt,
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    rowCounts: Object.fromEntries(Object.entries(tabs).map(([name, rows]) => [name, Math.max(0, rows.length - 1)])),
  };
}
