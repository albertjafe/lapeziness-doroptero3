import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-reservation-monitor-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const allowedSources = new Set(["alberto", "emma"]);
const allowedCommands = new Set([
  "pause",
  "resume",
  "target_today",
  "target_tomorrow",
  "set_operating_mode",
  "set_migration",
  "set_mirror",
  "set_madrugada",
  "set_aachen",
  "set_emergency",
]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanText(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
  return clean || null;
}

function cleanDate(value: unknown): string | null {
  const text = cleanText(value, 10);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanTime(value: unknown): string | null {
  const text = cleanText(value, 5);
  return text && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

function cleanInteger(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  return Math.max(min, Math.min(max, number));
}

function cleanBoolean(value: unknown): boolean {
  return value === true;
}

function cleanReservation(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    event_id: cleanInteger(raw.event_id, 1, 2_147_483_647),
    start: cleanTime(raw.start),
    end: cleanTime(raw.end),
    room: cleanText(raw.room, 40),
    type: cleanText(raw.type, 80),
    status: cleanText(raw.status, 24) || "scheduled",
    locked: cleanBoolean(raw.locked),
    confirmed: cleanBoolean(raw.confirmed),
  };
}

function cleanQuota(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    rf_mins: cleanInteger(raw.rf_mins, 0, 24 * 60) || 0,
    sz_mins: cleanInteger(raw.sz_mins, 0, 24 * 60) || 0,
    sz_applicable: cleanBoolean(raw.sz_applicable),
  };
}

function cleanState(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const monitorRaw = raw.monitor && typeof raw.monitor === "object"
    ? raw.monitor as Record<string, unknown>
    : {};
  const operatingRaw = monitorRaw.operating_mode && typeof monitorRaw.operating_mode === "object"
    ? monitorRaw.operating_mode as Record<string, unknown>
    : {};
  const transitionRaw = raw.transition && typeof raw.transition === "object"
    ? raw.transition as Record<string, unknown>
    : null;
  const reservations = Array.isArray(raw.reservations)
    ? raw.reservations.slice(0, 32).map(cleanReservation)
    : [];
  const scans = Array.isArray(raw.scans)
    ? raw.scans.slice(0, 12).map((item) => {
        const scan = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          group: cleanInteger(scan.group, 1, 999),
          date: cleanDate(scan.date),
          mode: cleanText(scan.mode, 30),
          observed_at: cleanText(scan.observed_at, 40),
        };
      })
    : [];

  return {
    date: cleanDate(raw.date),
    reservations,
    quota: cleanQuota(raw.quota),
    transition: transitionRaw ? {
      date: cleanDate(transitionRaw.date),
      reservations: Array.isArray(transitionRaw.reservations)
        ? transitionRaw.reservations.slice(0, 32).map(cleanReservation)
        : [],
      quota: cleanQuota(transitionRaw.quota),
    } : null,
    monitor: {
      online: cleanBoolean(monitorRaw.online),
      paused: cleanBoolean(monitorRaw.paused),
      target_date: cleanDate(monitorRaw.target_date),
      operating_mode: {
        code: cleanText(operatingRaw.code, 8) || "1",
        name: cleanText(operatingRaw.name, 40) || "Normal",
      },
      efficient: cleanBoolean(monitorRaw.efficient),
      paod_state: cleanText(monitorRaw.paod_state, 60) || "PAOD off",
      migration_enabled: cleanBoolean(monitorRaw.migration_enabled),
      mirror_enabled: monitorRaw.mirror_enabled == null ? null : cleanBoolean(monitorRaw.mirror_enabled),
      madrugada_enabled: cleanBoolean(monitorRaw.madrugada_enabled),
      aachen_only: cleanBoolean(monitorRaw.aachen_only),
      emergency_enabled: cleanBoolean(monitorRaw.emergency_enabled),
      min_slot_duration: cleanInteger(monitorRaw.min_slot_duration, 15, 720),
      monitor_window: {
        start: cleanTime((monitorRaw.monitor_window as Record<string, unknown> | undefined)?.start),
        end: cleanTime((monitorRaw.monitor_window as Record<string, unknown> | undefined)?.end),
      },
      blind_periods: Array.isArray(monitorRaw.blind_periods)
        ? monitorRaw.blind_periods.slice(0, 16).map((period) => Array.isArray(period)
          ? [cleanTime(period[0]), cleanTime(period[1])]
          : [null, null])
        : [],
      blinded_rooms: Array.isArray(monitorRaw.blinded_rooms)
        ? monitorRaw.blinded_rooms.slice(0, 120).map((room) => cleanInteger(room, 1, 99_999)).filter(Boolean)
        : [],
      blinded_groups: Array.isArray(monitorRaw.blinded_groups)
        ? monitorRaw.blinded_groups.slice(0, 20).map((group) => cleanInteger(group, 1, 999)).filter(Boolean)
        : [],
      priority_rooms: Array.isArray(monitorRaw.priority_rooms)
        ? monitorRaw.priority_rooms.slice(0, 120).map((room) => cleanInteger(room, 1, 99_999)).filter(Boolean)
        : [],
    },
    scans,
    success_rate: cleanText(raw.success_rate, 12) || "100%",
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 256 * 1024) return json(413, { error: "payload_too_large" });

  const token = req.headers.get("x-reservation-monitor-token")?.trim() || "";
  if (token.length < 24 || token.length > 256) return json(401, { error: "invalid_token" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "server_not_configured" });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = await sha256(token);
  const { data: tokenRow, error: tokenError } = await service
    .from("reservation_monitor_tokens")
    .select("id,user_id,source")
    .eq("token_hash", tokenHash)
    .eq("enabled", true)
    .maybeSingle();

  if (tokenError) return json(500, { error: "token_lookup_failed" });
  if (!tokenRow) return json(401, { error: "invalid_token" });

  const requestUrl = new URL(req.url);
  if (req.method === "GET") {
    const source = cleanText(requestUrl.searchParams.get("source"), 20);
    if (!source || !allowedSources.has(source)) return json(400, { error: "invalid_source" });
    if (source !== tokenRow.source) return json(403, { error: "source_not_allowed" });

    const expiry = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const reclaimBefore = new Date(Date.now() - 60 * 1000).toISOString();
    await service
      .from("reservation_monitor_commands")
      .update({ status: "pending", claimed_at: null })
      .eq("user_id", tokenRow.user_id)
      .eq("source", source)
      .eq("status", "claimed")
      .lt("claimed_at", reclaimBefore);
    await service
      .from("reservation_monitor_commands")
      .update({ status: "expired", completed_at: new Date().toISOString(), result: "Orden caducada" })
      .eq("user_id", tokenRow.user_id)
      .eq("source", source)
      .eq("status", "pending")
      .lt("created_at", expiry);

    const { data: commands, error } = await service
      .from("reservation_monitor_commands")
      .select("id,command,payload,created_at")
      .eq("user_id", tokenRow.user_id)
      .eq("source", source)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) return json(500, { error: "command_fetch_failed" });

    const fetchedCommands = commands || [];
    const invalidIds = fetchedCommands
      .filter((command) => !allowedCommands.has(command.command))
      .map((command) => command.id);
    if (invalidIds.length) {
      await service
        .from("reservation_monitor_commands")
        .update({ status: "rejected", completed_at: new Date().toISOString(), result: "Orden no permitida" })
        .eq("user_id", tokenRow.user_id)
        .eq("source", source)
        .in("id", invalidIds);
    }
    const safeCommands = fetchedCommands.filter((command) => allowedCommands.has(command.command));
    const ids = safeCommands.map((command) => command.id);
    let claimedCommands = safeCommands;
    if (ids.length) {
      const { data: claimedRows, error: claimError } = await service
        .from("reservation_monitor_commands")
        .update({ status: "claimed", claimed_at: new Date().toISOString() })
        .eq("user_id", tokenRow.user_id)
        .eq("source", source)
        .eq("status", "pending")
        .in("id", ids)
        .select("id");
      if (claimError) return json(500, { error: "command_claim_failed" });
      const claimedIds = new Set((claimedRows || []).map((row) => row.id));
      claimedCommands = safeCommands.filter((command) => claimedIds.has(command.id));
    }

    await service.from("reservation_monitor_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", tokenRow.id);
    return json(200, { ok: true, commands: claimedCommands });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  if (body.kind === "ack") {
    const id = cleanText(body.command_id, 50);
    const source = cleanText(body.source, 20);
    const status = body.status === "applied" || body.status === "rejected" || body.status === "error"
      ? body.status
      : null;
    if (!id || !source || !allowedSources.has(source) || !status) {
      return json(400, { error: "invalid_ack" });
    }
    if (source !== tokenRow.source) return json(403, { error: "source_not_allowed" });
    const { error } = await service
      .from("reservation_monitor_commands")
      .update({
        status,
        completed_at: new Date().toISOString(),
        result: cleanText(body.result, 500),
      })
      .eq("id", id)
      .eq("user_id", tokenRow.user_id)
      .eq("source", source)
      .eq("status", "claimed");
    if (error) return json(500, { error: "ack_failed" });
    return json(200, { ok: true });
  }

  const source = cleanText(body.source, 20);
  if (!source || !allowedSources.has(source)) return json(400, { error: "invalid_source" });
  if (source !== tokenRow.source) return json(403, { error: "source_not_allowed" });
  if (Number(body.schema_version) !== 1) return json(400, { error: "unsupported_schema_version" });

  const nowDate = new Date();
  const observedDate = new Date(String(body.observed_at || ""));
  const observedTime = observedDate.getTime();
  const observedAt = Number.isNaN(observedTime)
    || observedTime > nowDate.getTime() + 60 * 1000
    || observedTime < nowDate.getTime() - 24 * 60 * 60 * 1000
    ? nowDate.toISOString()
    : observedDate.toISOString();
  const now = nowDate.toISOString();
  const { error } = await service.from("reservation_monitor_state").upsert({
    user_id: tokenRow.user_id,
    source,
    schema_version: 1,
    instance_id: cleanText(body.instance_id, 100),
    observed_at: observedAt,
    heartbeat_at: now,
    state: cleanState(body.state),
    updated_at: now,
  }, { onConflict: "user_id,source" });

  if (error) return json(500, { error: "state_upsert_failed" });
  await service.from("reservation_monitor_tokens")
    .update({ last_used_at: now })
    .eq("id", tokenRow.id);
  return json(200, { ok: true, accepted_at: now });
});
