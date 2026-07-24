import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from 'jsr:@supabase/server@^1';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

type PushEvent = {
  event_id: string;
  user_id: string;
  run_id: string;
  event_kind: 'timer-countdown' | 'stopwatch-milestone';
  warning_minutes: number | null;
  milestone_minutes: number | null;
  work_name: string;
};

type StoredSubscription = {
  id: string;
  user_id: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  };
};

const cronSecret = Deno.env.get('CRON_SECRET')!;
const appUrl = Deno.env.get('APP_URL') ||
  'https://albertjafe.github.io/lapeziness-doroptero3/index.html?view=cronometro';

function base64UrlBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function createApplicationServer() {
  const publicKey = base64UrlBytes(Deno.env.get('VAPID_PUBLIC_KEY') || '');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  if (publicKey.length !== 65 || publicKey[0] !== 4 || !privateKey) {
    throw new Error('Invalid VAPID configuration');
  }

  const x = publicKey.slice(1, 33);
  const y = publicKey.slice(33, 65);
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const common = { kty: 'EC', crv: 'P-256', x: encode(x), y: encode(y) };
  const vapidKeys = await webpush.importVapidKeys({
    publicKey: { ...common, ext: true, key_ops: ['verify'] },
    privateKey: { ...common, d: privateKey, ext: true, key_ops: ['sign'] },
  });

  return webpush.ApplicationServer.new({
    contactInformation: Deno.env.get('VAPID_SUBJECT') ||
      'https://albertjafe.github.io/lapeziness-doroptero3/',
    vapidKeys,
  });
}

const applicationServerPromise = createApplicationServer();

function notificationFor(event: PushEvent) {
  const name = event.work_name || 'Sesión de estudio';
  if (event.event_kind === 'timer-countdown') {
    const minutes = Math.max(1, Number(event.warning_minutes) || 1);
    return {
      title: `Quedan ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`,
      body: `${name} · Tu temporizador sigue en marcha.`,
      tag: `crono-timer-${event.run_id}-${minutes}`,
      data: { url: appUrl, view: 'cronometro', runId: event.run_id },
    };
  }
  const minutes = Math.max(15, Number(event.milestone_minutes) || 15);
  return {
    title: `Has logrado ${minutes} minutos`,
    body: `${name} · El cronómetro sigue en marcha.`,
    tag: `crono-milestone-${event.run_id}-${minutes}`,
    data: { url: appUrl, view: 'cronometro', runId: event.run_id },
  };
}

async function dispatchPush(request: Request, context: { supabaseAdmin: any }) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = context.supabaseAdmin;
  const { data, error } = await supabase.rpc('claim_due_push_events', { p_limit: 100 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const events = (data || []) as PushEvent[];
  const userIds = [...new Set(events.map(event => event.user_id))];
  if (!userIds.length) return Response.json({ events: 0, sent: 0, removed: 0 });

  const { data: stored, error: subscriptionsError } = await supabase
    .from('push_subscriptions')
    .select('id,user_id,subscription')
    .in('user_id', userIds);
  if (subscriptionsError) return Response.json({ error: subscriptionsError.message }, { status: 500 });

  const subscriptions = (stored || []) as StoredSubscription[];
  const applicationServer = await applicationServerPromise;
  let sent = 0;
  let removed = 0;
  for (const event of events) {
    const payload = JSON.stringify(notificationFor(event));
    for (const storedSubscription of subscriptions.filter(item => item.user_id === event.user_id)) {
      try {
        await applicationServer.subscribe(storedSubscription.subscription).pushTextMessage(payload, {
          ttl: 120,
          urgency: webpush.Urgency.High,
        });
        sent += 1;
      } catch (pushError) {
        const statusCode = pushError instanceof webpush.PushMessageError
          ? pushError.response.status
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', storedSubscription.id);
          removed += 1;
        } else {
          console.error('Push delivery failed', { statusCode, eventId: event.event_id });
        }
      }
    }
  }

  return Response.json({ events: events.length, sent, removed });
}

export default {
  fetch: withSupabase({ auth: 'none' }, dispatchPush),
};
