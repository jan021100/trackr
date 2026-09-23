import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile shell identifies Lite mode and removes the secondary System tab only at the mobile breakpoint', () => {
  const layout = read('src/routes/(app)/+layout.svelte');
  assert.match(layout, /mobile-mode-label[^>]*>Lite</);
  assert.match(layout, /class:mobile-secondary=\{tab\.key === 'system'\}/);
  assert.match(layout, /@media\(max-width:760px\)[\s\S]*\.tab-btn\.mobile-secondary\{display:none\}/);
});

test('mobile clothing keeps wear actions while hiding inventory administration', () => {
  const clothing = read('src/routes/(app)/clothing/+page.svelte');
  assert.match(clothing, /class="worn-today-button"/);
  assert.match(clothing, /@media\(max-width:760px\)[\s\S]*\.actions,\.tile-actions\{display:none!important\}/);
});

test('mobile Life hides editors but keeps completion and reading-session controls', () => {
  const life = read('src/routes/(app)/life/+page.svelte');
  assert.match(life, /on:click=\{\(\) => completeTask\(row\.task\)\}/);
  assert.match(life, /class="panel reading-form"/);
  assert.match(life, /\.form-panel,\.household-import,\.book-form,[\s\S]*display:none!important/);
});

test('mobile Study keeps the learning loop while hiding secondary administration', () => {
  const study = read('src/routes/(app)/study/+page.svelte');
  const review = read('src/routes/(app)/study/review/+page.svelte');
  assert.match(study, />Retention</);
  assert.match(study, /Copy study prompt/);
  assert.match(study, /class="panel wide import-panel"/);
  assert.match(study, /class="panel study-week-panel"/);
  assert.match(study, /<PaediatricsWeekTimeline \{sessions\} timeZone=\{localTimeZone\}/);
  assert.match(study, /class="primary mobile-patch-apply"[^>]*on:click=\{applyJsonPatch\}/);
  assert.match(study, /\.desktop-study-control,\.topics-panel,\.patch-admin-control\{display:none!important\}/);
  assert.doesNotMatch(study, /\.desktop-study-control,\.import-panel,\.topics-panel\{display:none!important\}/);
  assert.match(review, /class="retention-admin-control"/);
  assert.match(review, /@media\(max-width:700px\)[\s\S]*\.retention-admin-control\{display:none\}/);
});
