import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SHEETS_SCOPE, syncAiActivityLog } from "./ai-log.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const APP_URL = Deno.env.get("APP_URL") || "https://albertjafe.github.io/lapeziness-doroptero3/";
const REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI") ||
  "https://fexfeekifzgszluemihs.supabase.co/functions/v1/google-calendar/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  SHEETS_SCOPE,
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function appRedirect(status: "connected" | "error", detail = "") {
  const target = new URL(APP_URL);
  target.searchParams.set("google_calendar", status);
  if (detail) target.searchParams.set("google_calendar_detail", detail);
  return Response.redirect(target.toString(), 302);
}

function bytesToBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function encryptionKey() {
  const encoded = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") || "";
  const raw = base64UrlToBytes(encoded);
  if (raw.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must contain 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptToken(ciphertext: string) {
  const [version, iv, payload] = String(ciphertext || "").split(".");
  if (version !== "v1" || !iv || !payload) throw new Error("Invalid stored token");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    await encryptionKey(),
    base64UrlToBytes(payload),
  );
  return new TextDecoder().decode(decrypted);
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function googleToken(params: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || "Google token exchange failed");
  return payload;
}

async function accessToken(refreshToken: string) {
  const payload = await googleToken(new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "",
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }));
  return payload.access_token as string;
}

async function googleGet(path: string, token: string) {
  const response = await fetch(`${GOOGLE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Google Calendar request failed");
  return payload;
}

async function connectionFor(userId: string) {
  const { data, error } = await admin.from("google_calendar_connections")
    .select("refresh_token_ciphertext,scopes,connected_at,updated_at,ai_log_spreadsheet_id,ai_log_synced_at")
    .eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

function hasScope(connection: any, scope: string) {
  return Array.isArray(connection?.scopes) && connection.scopes.includes(scope);
}

async function authorize(userId: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!clientId) throw new Error("Google Calendar is not configured");
  const state = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const stateHash = await sha256(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await admin.from("google_calendar_oauth_states").upsert({
    user_id: userId,
    state_hash: stateHash,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function oauthCallback(url: URL) {
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const oauthError = url.searchParams.get("error");
  if (oauthError) return appRedirect("error", oauthError);
  if (!state || !code) return appRedirect("error", "missing_oauth_data");

  const stateHash = await sha256(state);
  const { data: storedState, error: stateError } = await admin
    .from("google_calendar_oauth_states")
    .select("user_id,expires_at")
    .eq("state_hash", stateHash).maybeSingle();
  if (stateError || !storedState || new Date(storedState.expires_at).getTime() < Date.now()) {
    return appRedirect("error", "expired_state");
  }
  await admin.from("google_calendar_oauth_states").delete().eq("user_id", storedState.user_id);

  try {
    const token = await googleToken(new URLSearchParams({
      code,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }));
    if (!token.refresh_token) throw new Error("Google did not return a refresh token");
    const { error } = await admin.from("google_calendar_connections").upsert({
      user_id: storedState.user_id,
      refresh_token_ciphertext: await encryptToken(token.refresh_token),
      scopes: String(token.scope || "").split(/\s+/).filter(Boolean),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return appRedirect("connected");
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return appRedirect("error", "token_exchange_failed");
  }
}

function sanitizedCalendar(calendar: any) {
  return {
    id: String(calendar.id || ""),
    name: String(calendar.summaryOverride || calendar.summary || "Calendario"),
    primary: Boolean(calendar.primary),
    color: String(calendar.backgroundColor || "#4285f4"),
  };
}

function sanitizedEvent(event: any, calendar: any) {
  return {
    id: String(event.id || ""),
    calendarId: String(calendar.id || ""),
    calendarName: String(calendar.name || "Calendario"),
    color: String(event.colorId ? calendar.color : calendar.color || "#4285f4"),
    title: String(event.summary || "Sin título"),
    start: String(event.start?.dateTime || event.start?.date || ""),
    end: String(event.end?.dateTime || event.end?.date || ""),
    allDay: Boolean(event.start?.date),
    htmlLink: String(event.htmlLink || ""),
  };
}

async function syncCalendars(connection: any, body: any) {
  const refreshToken = await decryptToken(connection.refresh_token_ciphertext);
  const token = await accessToken(refreshToken);
  const list = await googleGet("/users/me/calendarList?minAccessRole=reader&showHidden=false", token);
  const calendars = (list.items || []).map(sanitizedCalendar).filter((item: any) => item.id);
  const requested = Array.isArray(body.calendarIds) ? body.calendarIds.map(String) : [];
  const allowed = new Set(calendars.map((item: any) => item.id));
  let selected = requested.filter((id: string) => allowed.has(id)).slice(0, 12);
  if (!selected.length) selected = calendars.filter((item: any) => item.primary).map((item: any) => item.id).slice(0, 1);
  if (!selected.length && calendars[0]) selected = [calendars[0].id];

  const now = new Date();
  const defaultMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
  const defaultMax = new Date(now.getFullYear(), now.getMonth() + 8, 1).toISOString();
  const timeMin = String(body.timeMin || defaultMin);
  const timeMax = String(body.timeMax || defaultMax);
  const byId = new Map<string, any>(calendars.map((calendar: any): [string, any] => [calendar.id, calendar]));
  const eventGroups = await Promise.all(selected.map(async (calendarId: string) => {
    const query = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "1000",
    });
    const payload = await googleGet(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`, token);
    const calendar = byId.get(calendarId);
    return (payload.items || [])
      .filter((event: any) => event.status !== "cancelled" && (event.start?.date || event.start?.dateTime))
      .map((event: any) => sanitizedEvent(event, calendar));
  }));
  return { calendars, selectedIds: selected, events: eventGroups.flat() };
}

async function syncAiLog(connection: any, userId: string) {
  if (!hasScope(connection, SHEETS_SCOPE)) {
    throw new Error("Vuelve a conectar Google en la app para autorizar el registro IA en Google Sheets");
  }
  const refreshToken = await decryptToken(connection.refresh_token_ciphertext);
  const token = await accessToken(refreshToken);
  return syncAiActivityLog({ admin, connection, userId, accessToken: token });
}

async function disconnect(connection: any, userId: string) {
  try {
    const token = await decryptToken(connection.refresh_token_ciphertext);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (error) {
    console.warn("Google token revocation failed", error);
  }
  const { error } = await admin.from("google_calendar_connections").delete().eq("user_id", userId);
  if (error) throw error;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/callback")) return oauthCallback(url);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await authenticatedUser(request);
  if (!user) return json({ error: "Inicia sesión en la app para conectar Google" }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "status");
    const connection = await connectionFor(user.id);
    if (action === "status") {
      return json({
        connected: Boolean(connection),
        connectedAt: connection?.connected_at || null,
        aiLogScopeGranted: Boolean(connection && hasScope(connection, SHEETS_SCOPE)),
        aiLogSpreadsheetUrl: connection?.ai_log_spreadsheet_id
          ? `https://docs.google.com/spreadsheets/d/${connection.ai_log_spreadsheet_id}/edit`
          : null,
        aiLogSyncedAt: connection?.ai_log_synced_at || null,
      });
    }
    if (action === "authorize") return json({ authUrl: await authorize(user.id) });
    if (!connection) return json({ error: "Google no está conectado" }, 409);
    if (action === "sync") return json({ connected: true, ...(await syncCalendars(connection, body)) });
    if (action === "ai-log-sync") return json({ connected: true, ...(await syncAiLog(connection, user.id)) });
    if (action === "disconnect") {
      await disconnect(connection, user.id);
      return json({ connected: false });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("Google integration function failed", error);
    return json({ error: error instanceof Error ? error.message : "Google integration error" }, 500);
  }
});
