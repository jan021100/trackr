import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatSportsDuration,
  sportsByType,
  sportsByWeek,
  sportsWellnessSeries,
  sportsWeekStart,
  summarizeSports
} from '../src/lib/utils/sports.ts';

const activities = [
  { id: 'run', name: 'Run', type: 'Run', startDateLocal: '2026-08-19T07:00:00', movingTime: 3600, distance: 10000, elevationGain: 120, trainingLoad: 45, averageHeartRate: 150, averagePower: null, calories: null },
  { id: 'ride', name: 'Ride', type: 'Ride', startDateLocal: '2026-08-17T17:00:00', movingTime: 5400, distance: 42000, elevationGain: 500, trainingLoad: 70, averageHeartRate: 140, averagePower: 190, calories: null },
  { id: 'old', name: 'Run', type: 'Run', startDateLocal: '2026-08-10T08:00:00', movingTime: 1800, distance: 5000, elevationGain: 20, trainingLoad: 25, averageHeartRate: 145, averagePower: null, calories: null }
];

test('sports summaries preserve totals and group Monday-based weeks', () => {
  assert.equal(sportsWeekStart('2026-08-19T07:00:00'), '2026-08-17');
  assert.deepEqual(summarizeSports(activities), { count: 3, duration: 10800, distance: 57000, elevation: 640, load: 140 });
  const weeks = sportsByWeek(activities, '2026-08-20', 2);
  assert.deepEqual(weeks.map((week) => [week.weekStart, week.count, week.load]), [['2026-08-10', 1, 25], ['2026-08-17', 2, 115]]);
});

test('sports balance and duration formatting stay deterministic', () => {
  assert.deepEqual(sportsByType(activities).map((sport) => [sport.type, sport.count]), [['Run', 2], ['Ride', 1]]);
  assert.equal(formatSportsDuration(5400), '1h 30m');
  assert.equal(formatSportsDuration(1200), '20m');
});

test('wellness history produces aligned fitness, fatigue and form series', () => {
  const series = sportsWellnessSeries([
    { date: 'invalid', fitness: 100, fatigue: 100, form: 0 },
    { date: '2026-08-25', fitness: 18, fatigue: 20, form: -2 },
    { date: '2026-08-26', fitness: 19, fatigue: 18, form: 1 }
  ]);
  assert.deepEqual(series.labels, ['2026-08-25', '2026-08-26']);
  assert.deepEqual(series.fitness, [18, 19]);
  assert.deepEqual(series.fatigue, [20, 18]);
  assert.deepEqual(series.form, [-2, 1]);
});

test('Intervals credentials remain server-only and the proxy requires Firebase auth', () => {
  const endpoint = readFileSync(new URL('../src/routes/api/sports/+server.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/routes/(app)/sports/+page.svelte', import.meta.url), 'utf8');
  assert.match(endpoint, /\$env\/dynamic\/private/);
  assert.match(endpoint, /verifyFirebaseUser\(token\)/);
  assert.match(endpoint, /Authorization: `Basic \$\{authorization\}`/);
  assert.doesNotMatch(endpoint, /addDoc|setDoc|updateDoc|deleteDoc|writeBatch/);
  assert.doesNotMatch(page, /INTERVALS_ICU_API_KEY|API_KEY:/);
});

test('Firebase verification fallback remains fail-closed', () => {
  const serverAuth = readFileSync(new URL('../src/lib/server/firebase-admin.ts', import.meta.url), 'utf8');
  assert.match(serverAuth, /getAdminAuth\(\)\.verifyIdToken\(token\)/);
  assert.match(serverAuth, /accounts:lookup/);
  assert.match(serverAuth, /if \(!response\.ok\) throw adminError/);
  assert.match(serverAuth, /if \(!uid\) throw adminError/);
});

test('sports requests refresh a stale Firebase session once', () => {
  const helper = readFileSync(new URL('../src/lib/utils/firebase-auth-fetch.ts', import.meta.url), 'utf8');
  assert.match(helper, /response\.status === 401/);
  assert.match(helper, /request\(true\)/);
  assert.doesNotMatch(helper, /while\s*\(|setInterval|setTimeout/);
});
