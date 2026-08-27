import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Trackr has an installable phone app manifest and iOS metadata', () => {
  const manifest = JSON.parse(readFileSync(new URL('../static/manifest.webmanifest', import.meta.url), 'utf8'));
  const app = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/dashboard');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.match(app, /viewport-fit=cover/);
  assert.match(app, /apple-touch-icon/);
  assert.match(app, /manifest\.webmanifest/);
});

test('the service worker caches only static shell assets, never authenticated data', () => {
  const worker = readFileSync(new URL('../src/service-worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /CACHEABLE\.has\(url\.pathname\)/);
  assert.doesNotMatch(worker, /\/api\/|chatapi|__data\.json|firestore|googleapis/);
  assert.doesNotMatch(worker, /request\.mode\s*===\s*['"]navigate/);
});

test('the authenticated shell respects phone safe areas and dynamic viewport height', () => {
  const layout = readFileSync(new URL('../src/routes/(app)/+layout.svelte', import.meta.url), 'utf8');
  assert.match(layout, /safe-area-inset-bottom/);
  assert.match(layout, /min-height:100dvh/);
  assert.match(layout, /box-sizing:border-box/);
  assert.match(layout, /aria-current=/);
});

test('public hosting cannot use a caller-supplied user id to read private wardrobe data', () => {
  const endpoint = readFileSync(new URL('../src/routes/chatapi/+server.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /verifyFirebaseUser\(token\)/);
  assert.match(endpoint, /authorization\.startsWith\('Bearer '\)/);
  assert.doesNotMatch(endpoint, /const \{ messages, uid \}/);
  assert.doesNotMatch(endpoint, /console\.log/);
});
