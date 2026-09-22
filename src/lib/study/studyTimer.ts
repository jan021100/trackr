import type { ActiveStudyTimer, AnkiStudyTimer, SurgeryState, TopicStudyTimer } from './surgerySchema';

const parsed = (value?: string) => value ? new Date(value).getTime() : Number.NaN;

export function timerElapsedSeconds(timer: ActiveStudyTimer, now = Date.now()) {
  const runningSince = timer.status === 'running' ? parsed(timer.runningSince) : Number.NaN;
  const currentRun = Number.isFinite(runningSince) ? Math.max(0, Math.floor((now - runningSince) / 1000)) : 0;
  return Math.max(0, Math.floor(timer.accumulatedSeconds)) + currentRun;
}

export function isTopicStudyTimer(timer: ActiveStudyTimer | undefined): timer is TopicStudyTimer {
  return !!timer && timer.kind !== 'anki-gap';
}

export function isAnkiStudyTimer(timer: ActiveStudyTimer | undefined): timer is AnkiStudyTimer {
  return timer?.kind === 'anki-gap';
}

export function startStudyTimer(topicId: string, now = new Date()): TopicStudyTimer {
  const stamp = now.toISOString();
  return { topicId, startedAt: stamp, runningSince: stamp, accumulatedSeconds: 0, status: 'running' };
}

export function startAnkiStudyTimer(gapIds: string[], topicIds: string[], now = new Date()): AnkiStudyTimer {
  const stamp = now.toISOString();
  return {
    kind: 'anki-gap',
    batchId: crypto.randomUUID(),
    gapIds: [...new Set(gapIds)],
    topicIds: [...new Set(topicIds)],
    startedAt: stamp,
    runningSince: stamp,
    accumulatedSeconds: 0,
    status: 'running'
  };
}

export function pauseStudyTimer(timer: ActiveStudyTimer, now = new Date()): ActiveStudyTimer {
  const { runningSince: _runningSince, ...rest } = timer;
  return { ...rest, accumulatedSeconds: timerElapsedSeconds(timer, now.getTime()), status: 'paused' } as ActiveStudyTimer;
}

export function resumeStudyTimer(timer: ActiveStudyTimer, now = new Date()): ActiveStudyTimer {
  if (timer.status === 'running') return timer;
  return { ...timer, status: 'running', runningSince: now.toISOString() };
}

export function finishStudyTimer(state: SurgeryState, now = new Date()) {
  const next = structuredClone(state);
  const timer = next.activeStudyTimer;
  if (!timer) return { state: next, timer: undefined, durationSeconds: 0, endedAt: now.toISOString() };
  const durationSeconds = timerElapsedSeconds(timer, now.getTime());
  delete next.activeStudyTimer;
  next.updatedAt = now.toISOString();
  return { state: next, timer, durationSeconds, endedAt: now.toISOString() };
}

export function formatStudyDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatStudyDurationCompact(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}
