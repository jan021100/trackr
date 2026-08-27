export type DateKey = `${number}-${number}-${number}` | string;

export type HabitMode = 'boolean' | 'duration' | 'count';
export type HabitScheduleKind = 'daily' | 'weekdays' | 'weekly';

export type LifeHabit = {
  id: string;
  name: string;
  emoji: string;
  mode: HabitMode;
  unit?: string;
  scheduleKind: HabitScheduleKind;
  weekdays?: number[];
  timesPerWeek?: number;
  linkedEntityType?: 'book' | null;
  archived?: boolean;
  createdAt?: unknown;
};

export type LifeTask = {
  id: string;
  name: string;
  emoji: string;
  intervalDays: number;
  lastCompletedDate?: DateKey | null;
  archived?: boolean;
  createdAt?: unknown;
};

export type BookStatus = 'wishlist' | 'unread' | 'reading' | 'paused' | 'read' | 'abandoned';

export type LifeBook = {
  id: string;
  title: string;
  author: string;
  status: BookStatus;
  isbn?: string;
  coverUrl?: string;
  coverImageBase64?: string;
  totalPages?: number | null;
  currentPage?: number;
  startedDate?: DateKey | null;
  finishedDate?: DateKey | null;
  rating?: number | null;
  note?: string;
  archived?: boolean;
  createdAt?: unknown;
};

export type LifeEntryKind = 'habit' | 'task' | 'reading';

export type LifeEntry = {
  id: string;
  kind: LifeEntryKind;
  date: DateKey;
  habitId?: string;
  taskId?: string;
  bookId?: string;
  completed?: boolean;
  durationMinutes?: number | null;
  quantity?: number | null;
  currentPage?: number | null;
  note?: string;
  active?: boolean;
  previousLastCompletedDate?: DateKey | null;
  previousBookState?: Partial<LifeBook> | null;
  resultingBookState?: Partial<LifeBook> | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const STARTER_HABITS: Omit<LifeHabit, 'id' | 'createdAt'>[] = [
  { name: 'Read', emoji: '📖', mode: 'boolean', scheduleKind: 'daily', linkedEntityType: 'book', archived: false },
  { name: 'Practice piano', emoji: '🎹', mode: 'duration', unit: 'min', scheduleKind: 'daily', archived: false }
];

export function localDateKey(date = new Date()): DateKey {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateFromKey(key: DateKey): Date {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, Math.max(0, month - 1), day, 12);
}

export function addDays(key: DateKey, amount: number): DateKey {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function compareDateKeys(left: DateKey, right: DateKey): number {
  return String(left).localeCompare(String(right));
}

export function startOfWeek(key: DateKey): DateKey {
  const date = dateFromKey(key);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return localDateKey(date);
}

export function isHabitScheduledOn(habit: LifeHabit, key: DateKey): boolean {
  if (habit.archived) return false;
  if (habit.scheduleKind === 'daily' || habit.scheduleKind === 'weekly') return true;
  return (habit.weekdays ?? []).includes(dateFromKey(key).getDay());
}

export function isBookLinkedHabit(habit: LifeHabit): boolean {
  if (habit.linkedEntityType === 'book') return true;
  if (habit.linkedEntityType) return false;
  return ['read', 'reading', 'lesen'].includes(habit.name.trim().toLowerCase());
}

export function activeEntries(entries: LifeEntry[]): LifeEntry[] {
  return entries.filter((entry) => entry.active !== false && entry.completed !== false);
}

export function habitEntryForDate(entries: LifeEntry[], habitId: string, key: DateKey): LifeEntry | undefined {
  return activeEntries(entries).find(
    (entry) => entry.habitId === habitId && entry.date === key
  );
}

export function weeklyHabitCount(entries: LifeEntry[], habitId: string, key: DateKey): number {
  const first = startOfWeek(key);
  const last = addDays(first, 6);
  return new Set(activeEntries(entries).filter(
    (entry) => entry.habitId === habitId
      && compareDateKeys(entry.date, first) >= 0 && compareDateKeys(entry.date, last) <= 0
  ).map((entry) => entry.date)).size;
}

export function isHabitComplete(entries: LifeEntry[], habit: LifeHabit, key: DateKey): boolean {
  if (habit.scheduleKind === 'weekly') {
    return weeklyHabitCount(entries, habit.id, key) >= Math.max(1, habit.timesPerWeek ?? 1);
  }
  return Boolean(habitEntryForDate(entries, habit.id, key));
}

export type TaskDueState = {
  lastDone: DateKey | null;
  dueDate: DateKey | null;
  daysUntilDue: number | null;
  tone: 'new' | 'ok' | 'soon' | 'due' | 'overdue';
  label: string;
};

export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 86_400_000);
}

export function taskDueState(task: LifeTask, entries: LifeEntry[], today: DateKey): TaskDueState {
  const completions = activeEntries(entries)
    .filter((entry) => entry.kind === 'task' && entry.taskId === task.id)
    .sort((a, b) => compareDateKeys(b.date, a.date));
  const lastDone = completions[0]?.date ?? null;
  if (!lastDone) return { lastDone: null, dueDate: null, daysUntilDue: null, tone: 'new', label: 'Not completed yet' };

  const dueDate = addDays(lastDone, Math.max(1, Number(task.intervalDays) || 1));
  const daysUntilDue = daysBetween(today, dueDate);
  if (daysUntilDue < 0) {
    const overdue = Math.abs(daysUntilDue);
    return { lastDone, dueDate, daysUntilDue, tone: 'overdue', label: `${overdue} day${overdue === 1 ? '' : 's'} overdue` };
  }
  if (daysUntilDue === 0) return { lastDone, dueDate, daysUntilDue, tone: 'due', label: 'Due today' };
  if (daysUntilDue <= Math.min(3, Math.max(1, Math.floor(task.intervalDays / 4)))) {
    return { lastDone, dueDate, daysUntilDue, tone: 'soon', label: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}` };
  }
  return { lastDone, dueDate, daysUntilDue, tone: 'ok', label: `Due in ${daysUntilDue} days` };
}

export function recentDateKeys(days: number, end: DateKey): DateKey[] {
  return Array.from({ length: Math.max(0, days) }, (_, index) => addDays(end, index - days + 1));
}

export function scheduledHabitStats(habit: LifeHabit, entries: LifeEntry[], end: DateKey, days = 84) {
  const dates = recentDateKeys(days, end);
  if (habit.scheduleKind === 'weekly') {
    const target = Math.max(1, habit.timesPerWeek ?? 1);
    const weeks = [...new Set(dates.map((date) => startOfWeek(date)))];
    const completed = weeks.reduce((sum, week) => {
      const weekEnd = addDays(week, 6);
      const count = new Set(activeEntries(entries).filter((entry) => entry.habitId === habit.id
        && compareDateKeys(entry.date, week) >= 0 && compareDateKeys(entry.date, weekEnd) <= 0)
        .map((entry) => entry.date)).size;
      return sum + Math.min(target, count);
    }, 0);
    const scheduled = weeks.length * target;
    return { scheduled, completed, rate: scheduled ? Math.round((completed / scheduled) * 100) : 0 };
  }
  const scheduled = dates.filter((date) => isHabitScheduledOn(habit, date));
  const completed = scheduled.filter((date) => Boolean(habitEntryForDate(entries, habit.id, date)));
  return {
    scheduled: scheduled.length,
    completed: completed.length,
    rate: scheduled.length ? Math.round((completed.length / scheduled.length) * 100) : 0
  };
}

export function bookProgress(book: LifeBook): number {
  const total = Number(book.totalPages ?? 0);
  const current = Number(book.currentPage ?? 0);
  if (!total || total < 1) return book.status === 'read' ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

export function safeNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
