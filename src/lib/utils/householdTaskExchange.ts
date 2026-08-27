export const TRACKR_HOUSEHOLD_FORMAT = 'trackr-household-tasks';
export const TRACKR_HOUSEHOLD_VERSION = 1;
export const TRACKR_HOUSEHOLD_MAX_TASKS = 100;

export type HouseholdTaskDraft = {
  name: string;
  emoji: string;
  intervalDays: number;
};

export type HouseholdTaskImportResult = {
  ok: boolean;
  tasks: HouseholdTaskDraft[];
  errors: string[];
};

export function normalizeHouseholdTaskName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('No JSON object');
  return JSON.parse(raw.slice(first, last + 1));
}

function cleanEmoji(value: unknown): string {
  const emoji = String(value ?? '').trim();
  return emoji ? Array.from(emoji).slice(0, 8).join('') : '🧹';
}

export function parseHouseholdTaskCode(raw: string): HouseholdTaskImportResult {
  if (!raw.trim()) return { ok: false, tasks: [], errors: ['Paste a household task code first.'] };
  if (raw.length > 50_000) return { ok: false, tasks: [], errors: ['This task code is unexpectedly large and was not opened.'] };

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch {
    return { ok: false, tasks: [], errors: ['The household task code is not valid JSON. Ask ChatGPT to return TRACKR_HOUSEHOLD_TASKS_V1 exactly.'] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, tasks: [], errors: ['The household task code must contain one JSON object.'] };
  }

  const data = parsed as Record<string, unknown>;
  const errors: string[] = [];
  if (data.format !== TRACKR_HOUSEHOLD_FORMAT || Number(data.version) !== TRACKR_HOUSEHOLD_VERSION) {
    errors.push('Unsupported format. Expected trackr-household-tasks version 1.');
  }
  if (!Array.isArray(data.tasks)) errors.push('The code is missing its tasks list.');
  else if (!data.tasks.length) errors.push('The task list is empty.');
  else if (data.tasks.length > TRACKR_HOUSEHOLD_MAX_TASKS) errors.push(`A single import can contain at most ${TRACKR_HOUSEHOLD_MAX_TASKS} tasks.`);
  if (errors.length || !Array.isArray(data.tasks)) return { ok: false, tasks: [], errors };

  const tasks: HouseholdTaskDraft[] = [];
  const names = new Set<string>();
  data.tasks.forEach((candidate, index) => {
    const number = index + 1;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      errors.push(`Task ${number} is not an object.`);
      return;
    }
    const input = candidate as Record<string, unknown>;
    const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
    const normalized = normalizeHouseholdTaskName(name);
    const intervalDays = Number(input.intervalDays);
    if (!name) errors.push(`Task ${number} has no name.`);
    else if (name.length > 100) errors.push(`Task ${number} has a name longer than 100 characters.`);
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) {
      errors.push(`Task ${number} needs a whole-number interval between 1 and 3650 days.`);
    }
    if (normalized && names.has(normalized)) errors.push(`“${name}” appears more than once.`);
    names.add(normalized);
    if (name && name.length <= 100 && Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 3650) {
      tasks.push({ name, emoji: cleanEmoji(input.emoji), intervalDays });
    }
  });

  return { ok: errors.length === 0, tasks: errors.length ? [] : tasks, errors };
}

export function buildHouseholdTaskPrompt(existingTasks: readonly { name: string; intervalDays: number }[] = []): string {
  const existing = existingTasks.length
    ? JSON.stringify(existingTasks.map((task) => ({ name: task.name, intervalDays: task.intervalDays })), null, 2)
    : 'None yet';
  return `Help me create a realistic recurring household-maintenance plan for Trackr.

First ask me the concise questions you need about my home, household size, pets, appliances, surfaces, outdoor areas and how thorough I want the plan to be. After I answer, propose practical tasks with sensible intervals expressed as whole days. Avoid duplicate or unnecessarily granular tasks.

Existing active Trackr tasks to avoid duplicating:
${existing}

When the plan is ready, return only one code block in exactly this format. Use no comments and no additional keys:

TRACKR_HOUSEHOLD_TASKS_V1
{
  "format": "${TRACKR_HOUSEHOLD_FORMAT}",
  "version": ${TRACKR_HOUSEHOLD_VERSION},
  "tasks": [
    {
      "name": "Change bed linen",
      "emoji": "🛏️",
      "intervalDays": 14
    }
  ]
}

Rules: intervalDays must be a whole number from 1 to 3650; names must be unique and at most 100 characters; include no more than ${TRACKR_HOUSEHOLD_MAX_TASKS} tasks.`;
}
