import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyFirebaseUser } from '$lib/server/firebase-admin';
import type { SportsActivity, SportsWellness } from '$lib/utils/sports';

type CacheEntry = { expiresAt: number; payload: SportsResponse };
type SportsResponse = {
  syncedAt: string;
  athleteId: string;
  range: { oldest: string; newest: string; days: number };
  activities: SportsActivity[];
  wellness: SportsWellness[];
  rateLimit: { limit: string | null; remaining: string | null };
};

const cache = new Map<string, CacheEntry>();
const API_BASE = 'https://intervals.icu/api/v1';

function dayKey(date: Date) { return date.toISOString().slice(0, 10); }
function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeActivity(input: Record<string, unknown>): SportsActivity | null {
  const id = String(input.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(input.name ?? input.type ?? 'Activity'),
    type: String(input.type ?? 'Other'),
    startDateLocal: String(input.start_date_local ?? input.start_date ?? ''),
    movingTime: finite(input.moving_time),
    distance: finite(input.distance),
    elevationGain: finite(input.total_elevation_gain),
    trainingLoad: finite(input.icu_training_load ?? input.tss ?? input.training_load),
    averageHeartRate: optionalNumber(input.average_heartrate),
    averagePower: optionalNumber(input.average_watts ?? input.avg_power ?? input.icu_average_watts),
    calories: optionalNumber(input.calories)
  };
}

function sanitizeWellness(input: Record<string, unknown>): SportsWellness | null {
  const date = String(input.id ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const fitness = finite(input.ctl);
  const fatigue = finite(input.atl);
  return {
    date,
    fitness,
    fatigue,
    form: fitness - fatigue,
    rampRate: optionalNumber(input.rampRate),
    restingHeartRate: optionalNumber(input.restingHR),
    hrv: optionalNumber(input.hrv ?? input.hrvSDNN),
    sleepSeconds: optionalNumber(input.sleepSecs),
    sleepScore: optionalNumber(input.sleepScore),
    weight: optionalNumber(input.weight),
    readiness: optionalNumber(input.readiness)
  };
}

async function intervalsGet(path: string, params: URLSearchParams, apiKey: string) {
  const authorization = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const response = await fetch(`${API_BASE}${path}?${params}`, {
    headers: { Authorization: `Basic ${authorization}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    const error = new Error(`Intervals.icu returned ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return { data: await response.json() as unknown, headers: response.headers };
}

export async function GET({ request, url }) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Sign in to view sports data.' }, { status: 401 });

  let uid = '';
  try { uid = await verifyFirebaseUser(token); }
  catch { return json({ error: 'Your session could not be verified.' }, { status: 401 }); }

  const apiKey = env.INTERVALS_ICU_API_KEY?.trim();
  const athleteId = env.INTERVALS_ICU_ATHLETE_ID?.trim() || '0';
  if (!apiKey || !/^(?:0|i\d+)$/.test(athleteId)) {
    return json({ error: 'The Intervals.icu connection is not configured.' }, { status: 503 });
  }

  const days = Math.min(365, Math.max(14, Math.round(Number(url.searchParams.get('days')) || 90)));
  const newest = dayKey(new Date());
  const oldestDate = new Date();
  oldestDate.setUTCDate(oldestDate.getUTCDate() - days + 1);
  const oldest = dayKey(oldestDate);
  const cacheKey = `${uid}:${athleteId}:${days}:${newest}`;
  const cached = cache.get(cacheKey);
  const forceRefresh = url.searchParams.has('refresh');
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return json(cached.payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }

  try {
    const params = new URLSearchParams({ oldest, newest });
    const [activityResult, wellnessResult] = await Promise.all([
      intervalsGet(`/athlete/${athleteId}/activities`, new URLSearchParams({ ...Object.fromEntries(params), limit: '500' }), apiKey),
      intervalsGet(`/athlete/${athleteId}/wellness`, params, apiKey)
    ]);
    const activities = Array.isArray(activityResult.data)
      ? activityResult.data.map((entry) => sanitizeActivity(entry as Record<string, unknown>)).filter((entry): entry is SportsActivity => Boolean(entry)).sort((a, b) => b.startDateLocal.localeCompare(a.startDateLocal))
      : [];
    const wellness = Array.isArray(wellnessResult.data)
      ? wellnessResult.data.map((entry) => sanitizeWellness(entry as Record<string, unknown>)).filter((entry): entry is SportsWellness => Boolean(entry)).sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const payload: SportsResponse = {
      syncedAt: new Date().toISOString(), athleteId, range: { oldest, newest, days }, activities, wellness,
      rateLimit: {
        limit: activityResult.headers.get('x-ratelimit-limit'),
        remaining: activityResult.headers.get('x-ratelimit-remaining')
      }
    };
    cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, payload });
    return json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 401 || status === 403) return json({ error: 'Intervals.icu rejected the connection. Check the API key.' }, { status: 502 });
    if (status === 429) return json({ error: 'Intervals.icu rate limit reached. Please try again later.' }, { status: 429 });
    console.error('Intervals.icu sports request failed', error);
    return json({ error: 'Sports data is temporarily unavailable.' }, { status: 502 });
  }
}
