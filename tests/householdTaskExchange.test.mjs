import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHouseholdTaskPrompt,
  normalizeHouseholdTaskName,
  parseHouseholdTaskCode
} from '../src/lib/utils/householdTaskExchange.ts';

test('valid ChatGPT household code is normalized into safe task drafts', () => {
  const code = `Here is the result:\n\`\`\`json\nTRACKR_HOUSEHOLD_TASKS_V1
  {"format":"trackr-household-tasks","version":1,"tasks":[
    {"name":" Change   bed linen ","emoji":"🛏️","intervalDays":14},
    {"name":"Clean refrigerator","emoji":"🧊","intervalDays":30}
  ]}\n\`\`\``;
  const result = parseHouseholdTaskCode(code);
  assert.equal(result.ok, true);
  assert.deepEqual(result.tasks, [
    { name: 'Change bed linen', emoji: '🛏️', intervalDays: 14 },
    { name: 'Clean refrigerator', emoji: '🧊', intervalDays: 30 }
  ]);
});

test('malformed plans are rejected atomically', () => {
  const plans = [
    { format: 'wrong', version: 1, tasks: [{ name: 'One', intervalDays: 7 }] },
    { format: 'trackr-household-tasks', version: 1, tasks: [{ name: 'One', intervalDays: 0 }] },
    { format: 'trackr-household-tasks', version: 1, tasks: [{ name: 'One', intervalDays: 7.5 }] },
    { format: 'trackr-household-tasks', version: 1, tasks: [{ name: 'One', intervalDays: 7 }, { name: ' one ', intervalDays: 14 }] }
  ];
  for (const plan of plans) {
    const result = parseHouseholdTaskCode(JSON.stringify(plan));
    assert.equal(result.ok, false);
    assert.deepEqual(result.tasks, []);
    assert.ok(result.errors.length);
  }
  assert.equal(parseHouseholdTaskCode('x'.repeat(50_001)).ok, false);
});

test('the copied prompt teaches ChatGPT the exact format and includes existing tasks', () => {
  const prompt = buildHouseholdTaskPrompt([{ name: 'Vacuum', intervalDays: 7 }]);
  assert.match(prompt, /TRACKR_HOUSEHOLD_TASKS_V1/);
  assert.match(prompt, /"format": "trackr-household-tasks"/);
  assert.match(prompt, /"intervalDays": 7/);
  assert.match(prompt, /Vacuum/);
  assert.equal(normalizeHouseholdTaskName('  CLEAN   Fridge '), 'clean fridge');
});

test('Life previews first and commits new owner-scoped tasks in one atomic batch', () => {
  const source = readFileSync(new URL('../src/routes/(app)/life/+page.svelte', import.meta.url), 'utf8');
  assert.match(source, /parseHouseholdTaskCode\(householdImportCode\)/);
  assert.match(source, /const batch = writeBatch\(db\)[\s\S]*doc\(lifeCollection\(uid, 'lifeTasks'\)\)[\s\S]*batch\.set\(reference, payload\)[\s\S]*await batch\.commit\(\)/);
  assert.match(source, /lastCompletedDate: null/);
  assert.doesNotMatch(source, /deleteDoc/);
});
