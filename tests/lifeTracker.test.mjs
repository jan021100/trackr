import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  bookProgress,
  habitEntryForDate,
  isBookLinkedHabit,
  isHabitScheduledOn,
  scheduledHabitStats,
  taskDueState
} from '../src/lib/utils/lifeTracker.ts';

test('weekday habits are scheduled using local calendar days', () => {
  const habit = { id: 'read', name: 'Read', emoji: '📖', mode: 'boolean', scheduleKind: 'weekdays', weekdays: [1, 3, 5] };
  assert.equal(isHabitScheduledOn(habit, '2026-08-17'), true);
  assert.equal(isHabitScheduledOn(habit, '2026-08-18'), false);
  assert.equal(isHabitScheduledOn(habit, '2026-08-19'), true);
});

test('soft-undone entries do not count as completions', () => {
  const entries = [
    { id: 'a', kind: 'habit', habitId: 'read', date: '2026-08-18', active: false, completed: false },
    { id: 'b', kind: 'habit', habitId: 'read', date: '2026-08-19', active: true, completed: true }
  ];
  assert.equal(habitEntryForDate(entries, 'read', '2026-08-18'), undefined);
  assert.equal(habitEntryForDate(entries, 'read', '2026-08-19')?.id, 'b');
});

test('a book-linked reading session completes the habit without a duplicate habit log', () => {
  const habit = { id: 'read', name: 'Read', emoji: '📖', mode: 'boolean', scheduleKind: 'daily', linkedEntityType: 'book' };
  const entries = [{ id: 'session', kind: 'reading', habitId: 'read', bookId: 'book', date: '2026-08-19', active: true, currentPage: 128 }];
  assert.equal(isBookLinkedHabit(habit), true);
  assert.equal(habitEntryForDate(entries, habit.id, '2026-08-19')?.id, 'session');
});

test('legacy reading habits are recognized without rewriting stored documents', () => {
  assert.equal(isBookLinkedHabit({ id: 'old', name: 'Read', emoji: '📖', mode: 'boolean', scheduleKind: 'daily' }), true);
  assert.equal(isBookLinkedHabit({ id: 'other', name: 'Walk', emoji: '🚶', mode: 'boolean', scheduleKind: 'daily' }), false);
});

test('interval tasks calculate due and overdue dates from the actual activity date', () => {
  const task = { id: 'linen', name: 'Bed linen', emoji: '🛏️', intervalDays: 14 };
  const entries = [{ id: 'done', kind: 'task', taskId: 'linen', date: '2026-08-01', active: true }];
  assert.equal(taskDueState(task, entries, '2026-08-10').dueDate, '2026-08-15');
  assert.equal(taskDueState(task, entries, '2026-08-15').tone, 'due');
  assert.equal(taskDueState(task, entries, '2026-08-18').label, '3 days overdue');
});

test('12-week statistics use scheduled days without punishing unscheduled days', () => {
  const habit = { id: 'piano', name: 'Piano', emoji: '🎹', mode: 'duration', scheduleKind: 'weekdays', weekdays: [1] };
  const entries = [{ id: 'one', kind: 'habit', habitId: 'piano', date: '2026-08-17', active: true }];
  const stats = scheduledHabitStats(habit, entries, '2026-08-19', 7);
  assert.deepEqual(stats, { scheduled: 1, completed: 1, rate: 100 });
});

test('weekly targets count opportunities instead of treating every day as required', () => {
  const habit = { id: 'walk', name: 'Walk', emoji: '🚶', mode: 'boolean', scheduleKind: 'weekly', timesPerWeek: 2 };
  const entries = [
    { id: 'one', kind: 'habit', habitId: 'walk', date: '2026-08-17', active: true },
    { id: 'two', kind: 'habit', habitId: 'walk', date: '2026-08-18', active: true }
  ];
  assert.deepEqual(scheduledHabitStats(habit, entries, '2026-08-19', 3), { scheduled: 2, completed: 2, rate: 100 });
});

test('book progress is bounded and finished books without pages show complete', () => {
  assert.equal(bookProgress({ id: 'a', title: 'A', author: '', status: 'reading', totalPages: 200, currentPage: 50 }), 25);
  assert.equal(bookProgress({ id: 'b', title: 'B', author: '', status: 'reading', totalPages: 100, currentPage: 500 }), 100);
  assert.equal(bookProgress({ id: 'c', title: 'C', author: '', status: 'read' }), 100);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
