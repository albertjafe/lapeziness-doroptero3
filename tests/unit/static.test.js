import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('quality wiring', () => {
  it('loads the extracted browser cores before app.js', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html.indexOf('timer-core.js')).toBeLessThan(html.indexOf('app.js'));
    expect(html).toContain('data-core.js');
    expect(html).toContain('sync-core.js');
    expect(html.indexOf('push-client.js')).toBeLessThan(html.indexOf('app.js'));
  });

  it('installs a service-worker push handler and the Supabase dispatcher sources', () => {
    const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/202607230001_web_push.sql'),
      'utf8'
    );
    const dispatcher = fs.readFileSync(
      path.join(root, 'supabase/functions/study-push-dispatch/index.ts'),
      'utf8'
    );
    expect(worker).toContain("addEventListener('push'");
    expect(migration).toContain('claim_due_push_events');
    expect(dispatcher).toContain('pushTextMessage');
  });

  it('does not persist the legacy password payload', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    expect(app).not.toContain('_saveStoredCredentials');
    expect(app).not.toContain('localStorage.setItem(\'piano_auto_creds\'');
  });
});
