import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Actualización del monitor de aulas entre ordenadores (04-10-2026).
// Sólo responde a un token de monitor válido (el mismo que usa
// reservation-monitor-ingest) y todo queda dentro de la carpeta del usuario.
//   GET  ?action=latest    → última versión publicada + enlaces firmados a sus trozos
//   GET  ?action=presence  → ¿hay un monitor de este perfil vivo ahora mismo?
//   POST ?action=upload    → enlaces firmados para subir los trozos de una versión
//   POST ?action=publish   → comprueba los trozos subidos y la marca como la última
const BUCKET = "monitor-releases";
const MAX_PARTS = 64;
const PART_MAX_BYTES = 50 * 1024 * 1024;
const KEEP_VERSIONS = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-reservation-monitor-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const isVersion = (v: unknown): v is string => typeof v === "string" && /^\d{8}_\d{6}$/.test(v);
const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const partName = (n: number) => `part-${String(n).padStart(2, "0")}`;
const cleanHost = (v: unknown) => typeof v === "string" ? v.replace(/[^\w.\-]/g, "").slice(0, 63) : "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const token = req.headers.get("x-reservation-monitor-token")?.trim() || "";
  if (token.length < 24 || token.length > 256) return json(401, { error: "invalid_token" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "server_not_configured" });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tokenRow, error: tokenError } = await service
    .from("reservation_monitor_tokens")
    .select("id,user_id,source,last_used_at")
    .eq("token_hash", await sha256(token))
    .eq("enabled", true)
    .maybeSingle();
  if (tokenError) return json(500, { error: "token_lookup_failed" });
  if (!tokenRow) return json(401, { error: "invalid_token" });

  const storage = service.storage.from(BUCKET);
  const root = tokenRow.user_id as string;
  const action = new URL(req.url).searchParams.get("action") || "";

  if (req.method === "GET" && action === "presence") {
    // La consulta de órdenes (cada 3 s) renueva last_used_at del token; el
    // estado dice qué instancia (ordenador:proceso) publicó por última vez.
    const { data: state } = await service
      .from("reservation_monitor_state")
      .select("instance_id,heartbeat_at,state")
      .eq("user_id", root)
      .eq("source", tokenRow.source)
      .maybeSingle();
    const now = Date.now();
    const age = (iso: unknown) => typeof iso === "string" && Date.parse(iso) ? Math.round((now - Date.parse(iso)) / 1000) : null;
    const monitor = (state?.state as Record<string, any> | null)?.monitor || {};
    return json(200, {
      source: tokenRow.source,
      instance_id: state?.instance_id || null,
      heartbeat_age_s: age(state?.heartbeat_at),
      poll_age_s: age(tokenRow.last_used_at),
      phase: typeof monitor.phase === "string" ? monitor.phase : null,
    });
  }

  if (req.method === "GET" && action === "latest") {
    const { data: file } = await storage.download(`${root}/latest.json`);
    if (!file) return json(200, { version: null });
    let latest: Record<string, any>;
    try {
      latest = JSON.parse(await file.text());
    } catch {
      return json(200, { version: null });
    }
    if (!isVersion(latest.version) || !Array.isArray(latest.parts)) return json(200, { version: null });
    const paths = latest.parts.map((p: Record<string, unknown>) => `${root}/${latest.version}/${partName(Number(p.n))}`);
    const { data: signed, error } = await storage.createSignedUrls(paths, 15 * 60);
    if (error || !signed) return json(500, { error: "sign_failed" });
    return json(200, {
      version: latest.version,
      sha256: latest.sha256,
      size: latest.size,
      built_at: latest.built_at,
      host: latest.host,
      parts: latest.parts.map((p: Record<string, unknown>, i: number) => ({
        n: p.n, size: p.size, sha256: p.sha256, url: signed[i]?.signedUrl || null,
      })),
    });
  }

  if (req.method !== "POST") return json(400, { error: "unknown_action" });
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (!isVersion(body.version)) return json(400, { error: "invalid_version" });
  const count = Number(body.parts);

  if (action === "upload") {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PARTS) return json(400, { error: "invalid_parts" });
    const uploads = [];
    for (let n = 1; n <= count; n++) {
      const path = `${root}/${body.version}/${partName(n)}`;
      const { data, error } = await storage.createSignedUploadUrl(path, { upsert: true });
      if (error || !data) return json(500, { error: "sign_upload_failed", detail: error?.message || null });
      uploads.push({ n, url: data.signedUrl });
    }
    return json(200, { version: body.version, uploads });
  }

  if (action === "publish") {
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length || parts.length > MAX_PARTS || !isSha(body.sha256)) return json(400, { error: "invalid_release" });
    const { data: listed, error } = await storage.list(`${root}/${body.version}`, { limit: 100 });
    if (error) return json(500, { error: "list_failed" });
    const sizes = new Map((listed || []).map((o: Record<string, any>) => [o.name, Number(o.metadata?.size)]));
    let total = 0;
    for (const p of parts) {
      const size = Number(p.size);
      if (!Number.isInteger(p.n) || !isSha(p.sha256) || !(size > 0) || size > PART_MAX_BYTES) return json(400, { error: "invalid_part" });
      if (sizes.get(partName(p.n)) !== size) return json(409, { error: "part_missing_or_wrong_size", part: p.n });
      total += size;
    }
    if (total !== Number(body.size)) return json(400, { error: "size_mismatch" });
    const latest = {
      version: body.version,
      sha256: body.sha256,
      size: total,
      built_at: typeof body.built_at === "string" ? body.built_at.slice(0, 40) : null,
      host: cleanHost(body.host),
      parts: parts.map((p: Record<string, any>) => ({ n: p.n, size: Number(p.size), sha256: p.sha256 })),
    };
    const { error: upErr } = await storage.upload(`${root}/latest.json`,
      new Blob([JSON.stringify(latest)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (upErr) return json(500, { error: "publish_failed" });
    // Se guardan las últimas KEEP_VERSIONS versiones; las anteriores se borran.
    const { data: dirs } = await storage.list(root, { limit: 100 });
    const versions = (dirs || []).map((d: Record<string, any>) => d.name).filter(isVersion).sort().reverse();
    for (const old of versions.slice(KEEP_VERSIONS)) {
      const { data: files } = await storage.list(`${root}/${old}`, { limit: 100 });
      const paths = (files || []).map((f: Record<string, any>) => `${root}/${old}/${f.name}`);
      if (paths.length) await storage.remove(paths);
    }
    return json(200, { published: body.version, size: total, parts: parts.length });
  }

  return json(400, { error: "unknown_action" });
});
