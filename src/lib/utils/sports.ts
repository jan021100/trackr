export type SportsActivity = {
  id: string;
  name: string;
  type: string;
  startDateLocal: string;
  movingTime: number;
  distance: number;
  elevationGain: number;
  trainingLoad: number;
  averageHeartRate: number | null;
  averagePower: number | null;
  calories: number | null;
};

export type SportsWellness = {
  date: string;
  fitness: number;
  fatigue: number;
  form: number;
  rampRate: number | null;
  restingHeartRate: number | null;
  hrv: number | null;
  sleepSeconds: number | null;
  sleepScore: number | null;
  weight: number | null;
  readiness: number | null;
};

export type SportsTotals = {
  count: number;
  duration: number;
  distance: number;
  elevation: number;
  load: number;
};

export function sportsDateKey(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
}

export function sportsWeekStart(value: string): string {
  const key = sportsDateKey(value);
  if (!key) return '';
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function summarizeSports(activities: readonly SportsActivity[]): SportsTotals {
  return activities.reduce<SportsTotals>((totals, activity) => ({
    count: totals.count + 1,
    duration: totals.duration + Math.max(0, Number(activity.movingTime) || 0),
    distance: totals.distance + Math.max(0, Number(activity.distance) || 0),
    elevation: totals.elevation + Math.max(0, Number(activity.elevationGain) || 0),
    load: totals.load + Math.max(0, Number(activity.trainingLoad) || 0)
  }), { count: 0, duration: 0, distance: 0, elevation: 0, load: 0 });
}

export function sportsByWeek(activities: readonly SportsActivity[], endDate: string, weeks = 8) {
  const lastWeek = sportsWeekStart(endDate);
  if (!lastWeek) return [];
  const [year, month, day] = lastWeek.split('-').map(Number);
  return Array.from({ length: Math.max(1, weeks) }, (_, index) => {
    const start = new Date(Date.UTC(year, month - 1, day - ((weeks - index - 1) * 7)));
    const key = start.toISOString().slice(0, 10);
    const weekActivities = activities.filter((activity) => sportsWeekStart(activity.startDateLocal) === key);
    return { weekStart: key, ...summarizeSports(weekActivities) };
  });
}

export function sportsByType(activities: readonly SportsActivity[]) {
  const grouped = new Map<string, SportsActivity[]>();
  for (const activity of activities) {
    const type = activity.type.trim() || 'Other';
    grouped.set(type, [...(grouped.get(type) ?? []), activity]);
  }
  return [...grouped.entries()]
    .map(([type, values]) => ({ type, ...summarizeSports(values) }))
    .sort((a, b) => b.duration - a.duration || b.count - a.count);
}

export function sportsWellnessSeries(wellness: readonly SportsWellness[]) {
  const valid = wellness.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
  return {
    labels: valid.map((entry) => entry.date),
    shortLabels: valid.map((entry) => new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
    fitness: valid.map((entry) => Number.isFinite(entry.fitness) ? entry.fitness : 0),
    fatigue: valid.map((entry) => Number.isFinite(entry.fatigue) ? entry.fatigue : 0),
    form: valid.map((entry) => Number.isFinite(entry.form) ? entry.form : 0)
  };
}

export function formatSportsDuration(seconds: number): string {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

export function sportsTypeSymbol(type: string): string {
  const normalized = String(type ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (/(weighttraining|strength|crossfit|gym)/.test(normalized)) return '🏋️';
  if (/(trailrun)/.test(normalized)) return '🏃‍♂️';
  if (/(gravelride|mountainbike|mtb)/.test(normalized)) return '🚵';
  if (/(virtualride|ride|cycling|bike)/.test(normalized)) return '🚴';
  if (/(run|running)/.test(normalized)) return '🏃';
  if (/(openwaterswim|swim)/.test(normalized)) return '🏊';
  if (/(hike|hiking)/.test(normalized)) return '🥾';
  if (/(walk|walking)/.test(normalized)) return '🚶';
  if (/(rowing|row|kayak|canoe)/.test(normalized)) return '🚣';
  if (/(nordicski|crosscountryski)/.test(normalized)) return '⛷️';
  if (/(alpineski|ski|snowboard)/.test(normalized)) return '🎿';
  if (/(yoga|pilates|mobility|stretch)/.test(normalized)) return '🧘';
  if (/(golf)/.test(normalized)) return '⛳';
  if (/(soccer|football)/.test(normalized)) return '⚽';
  if (/(tennis|squash|badminton|racket)/.test(normalized)) return '🎾';
  if (/(elliptical|stair|cardio)/.test(normalized)) return '💓';
  return '●';
}
