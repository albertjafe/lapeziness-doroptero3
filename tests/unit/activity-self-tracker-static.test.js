import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync('activity-self-tracker.js', 'utf8');
const installer = fs.readFileSync('activity-tracker/windows/install.ps1', 'utf8');

describe('PWA self activity tracker', () => {
  it('tracks only visible app sections and queues offline segments', () => {
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain("label: `App · ${segment.view_label}`");
    expect(source).toContain('source: SOURCE');
    expect(source).toContain('pianoAppActivityQueue_v1');
  });

  it('does not contain hooks for keyboard, clipboard or input text', () => {
    expect(source).not.toMatch(/keydown|keyup|keypress|clipboard|input\.value|textarea\.value/i);
  });

  it('uses the authenticated user id and idempotent writes', () => {
    expect(source).toContain("typeof sb.auth.getUser !== 'function'");
    expect(source).toContain('user_id: user.id');
    expect(source).toContain("sb.from('activity_events').upsert(batch");
    expect(source).toContain("onConflict: 'user_id,device_id,source,external_id'");
    expect(source).toContain('ignoreDuplicates: true');
  });

  it('protects the Windows token instead of writing it as plaintext', () => {
    expect(installer).toContain('TokenProtected');
    expect(installer).toContain('ConvertFrom-SecureString');
    expect(installer).not.toContain('  Token = $Token.Trim()');
  });
});
