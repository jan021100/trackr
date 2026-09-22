import type { RetentionCard } from './retentionSchema';
import { summarizeAnkiReviewTime, type AnkiDailyStudyTime } from './ankiStudyTime';

export const ANKI_CONNECT_VERSION = 6;
export const DEFAULT_ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
export const DEFAULT_ANKI_GAP_DECK = 'Trackr::Surgery Gaps';
export const DEFAULT_ANKI_GAP_MODEL = 'Trackr Surgery Gap';

export const ANKI_GAP_MODEL_FIELDS = [
  'TrackrGapId',
  'TrackrCardId',
  'TrackrTopicId',
  'TopicTitle',
  'Question',
  'Answer',
  'SchemaVersion'
] as const;

export type AnkiConnectSettings = {
  url: string;
  deckName: string;
  modelName: string;
  apiKey?: string;
};

export type AnkiPermission = {
  permission: 'granted' | 'denied';
  requireApiKey?: boolean;
  version?: number;
};

export type AnkiNoteInfo = {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
  cards: number[];
};

export type AnkiCardInfo = {
  cardId: number;
  note: number;
  type: number;
  queue: number;
  interval: number;
  reps: number;
  lapses: number;
  factor?: number;
  due?: number;
  'prop:r'?: number | null;
  'prop:s'?: number | null;
  'prop:d'?: number | null;
};

export type AnkiReview = {
  id: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
};

export type AnkiCardProgress = {
  trackrCardId: string;
  noteId?: number;
  cardIds: number[];
  card?: AnkiCardInfo;
  reviews: AnkiReview[];
  due?: boolean;
  missing: boolean;
};

type AnkiResponse<T> = { result: T; error: string | null };

function cleanUrl(value: string) {
  return value.trim().replace(/\/+$/, '') || DEFAULT_ANKI_CONNECT_URL;
}

export function ankiTagPart(value: string) {
  return value.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '_');
}

export function ankiIdentityTags(card: Pick<RetentionCard, 'id' | 'topicId' | 'gapId'>) {
  return [
    'trackr',
    'retention',
    'trackr::surgery-gap',
    `trackr-id::${ankiTagPart(card.id)}`,
    `trackr-topic::${ankiTagPart(card.topicId)}`,
    ...(card.gapId ? [`trackr-gap::${ankiTagPart(card.gapId)}`] : [])
  ];
}

function ankiHtmlField(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

export async function invokeAnki<T>(settings: AnkiConnectSettings, action: string, params?: Record<string, unknown>, includeKey = true): Promise<T> {
  const body: Record<string, unknown> = { action, version: ANKI_CONNECT_VERSION };
  if (params && Object.keys(params).length) body.params = params;
  if (includeKey && settings.apiKey?.trim()) body.key = settings.apiKey.trim();
  let response: Response;
  try {
    response = await fetch(cleanUrl(settings.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('AnkiConnect is unavailable. Open Anki Desktop and make sure the AnkiConnect add-on is installed.');
  }
  if (!response.ok) throw new Error(`AnkiConnect returned HTTP ${response.status}.`);
  const payload = await response.json() as Partial<AnkiResponse<T>>;
  if (!Object.prototype.hasOwnProperty.call(payload, 'result') || !Object.prototype.hasOwnProperty.call(payload, 'error')) throw new Error('AnkiConnect returned an unexpected response.');
  if (payload.error) throw new Error(`AnkiConnect: ${payload.error}`);
  return payload.result as T;
}

export async function requestAnkiPermission(settings: AnkiConnectSettings) {
  const result = await invokeAnki<AnkiPermission>(settings, 'requestPermission', undefined, false);
  if (result.permission !== 'granted') throw new Error('AnkiConnect permission was denied in Anki.');
  if (result.requireApiKey && !settings.apiKey?.trim()) throw new Error('AnkiConnect requires an API key. Enter it in Trackr, then connect again.');
  await invokeAnki<number>(settings, 'version');
  return result;
}

export async function ensureAnkiGapDeck(settings: AnkiConnectSettings) {
  const decks = await invokeAnki<string[]>(settings, 'deckNames');
  if (!decks.includes(settings.deckName)) await invokeAnki<number>(settings, 'createDeck', { deck: settings.deckName });
  const models = await invokeAnki<string[]>(settings, 'modelNames');
  if (!models.includes(settings.modelName)) {
    await invokeAnki(settings, 'createModel', {
      modelName: settings.modelName,
      inOrderFields: [...ANKI_GAP_MODEL_FIELDS],
      css: '.card{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:22px;text-align:left;color:#1f2530;background:#fff;line-height:1.45}.topic{font-size:13px;color:#667085;text-transform:uppercase;letter-spacing:.08em;margin-bottom:18px}.answer{margin-top:20px}',
      isCloze: false,
      cardTemplates: [{
        Name: 'Gap recall',
        Front: '<div class="topic">{{TrackrTopicId}} · {{TopicTitle}}</div>{{Question}}',
        Back: '{{FrontSide}}<hr id="answer"><div class="answer">{{Answer}}</div>'
      }]
    });
  }
  const fields = await invokeAnki<string[]>(settings, 'modelFieldNames', { modelName: settings.modelName });
  const missing = ANKI_GAP_MODEL_FIELDS.filter((field) => !fields.includes(field));
  if (missing.length) throw new Error(`The Anki note type “${settings.modelName}” is missing: ${missing.join(', ')}.`);
}

function chunk<T>(items: T[], size = 250) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function notesInfo(settings: AnkiConnectSettings, ids: number[]) {
  const result: AnkiNoteInfo[] = [];
  for (const values of chunk(ids)) result.push(...await invokeAnki<AnkiNoteInfo[]>(settings, 'notesInfo', { notes: values }));
  return result;
}

async function reviewsForCardIds(settings: AnkiConnectSettings, cardIds: number[]) {
  const reviews = new Map<number, AnkiReview[]>();
  for (const ids of chunk([...new Set(cardIds)])) {
    const values = await invokeAnki<Record<string, AnkiReview[]>>(settings, 'getReviewsOfCards', { cards: ids });
    for (const id of ids) reviews.set(id, values[String(id)] ?? []);
  }
  return reviews;
}

function noteTrackrCardId(note: AnkiNoteInfo) {
  const field = note.fields.TrackrCardId?.value?.trim();
  if (field) return field;
  const tag = note.tags.find((value) => value.startsWith('trackr-id::'));
  return tag ? tag.slice('trackr-id::'.length) : undefined;
}

async function discoverNotes(settings: AnkiConnectSettings, cards: RetentionCard[]) {
  const byStoredId = new Map(cards.flatMap((card) => card.anki?.noteId ? [[card.anki.noteId, card.id] as const] : []));
  const noteIds = new Set<number>(byStoredId.keys());
  const tagged = await invokeAnki<number[]>(settings, 'findNotes', { query: 'tag:retention' });
  for (const id of tagged) noteIds.add(id);
  const notes = noteIds.size ? await notesInfo(settings, [...noteIds]) : [];
  const byCardId = new Map<string, AnkiNoteInfo>();
  for (const note of notes) {
    const exact = noteTrackrCardId(note);
    if (exact) byCardId.set(exact, note);
    const stored = byStoredId.get(note.noteId);
    if (stored) byCardId.set(stored, note);
  }
  for (const card of cards) {
    if (byCardId.has(card.id)) continue;
    const safe = ankiTagPart(card.id);
    const matched = notes.find((note) => noteTrackrCardId(note) === safe || note.tags.includes(`trackr-id::${safe}`));
    if (matched) byCardId.set(card.id, matched);
  }
  return byCardId;
}

export async function sendGapCardsToAnki(settings: AnkiConnectSettings, cards: RetentionCard[], topicTitle: (topicId: string) => string) {
  const gapCards = cards.filter((card) => card.gapId && card.status !== 'archived');
  if (!gapCards.length) return [] as Array<{ cardId: string; noteId: number; cardIds: number[] }>;
  await ensureAnkiGapDeck(settings);
  let existing = await discoverNotes(settings, gapCards);
  const missing = gapCards.filter((card) => !existing.has(card.id));
  if (missing.length) {
    const noteIds = await invokeAnki<Array<number | null>>(settings, 'addNotes', {
      notes: missing.map((card) => ({
        deckName: settings.deckName,
        modelName: settings.modelName,
        fields: {
          TrackrGapId: card.gapId ?? '',
          TrackrCardId: card.id,
          TrackrTopicId: card.topicId,
          TopicTitle: ankiHtmlField(topicTitle(card.topicId)),
          Question: ankiHtmlField(card.front),
          Answer: ankiHtmlField(card.back),
          SchemaVersion: '1'
        },
        tags: [...new Set([...card.tags, ...ankiIdentityTags(card)])],
        options: { allowDuplicate: false, duplicateScope: 'collection' }
      }))
    });
    if (noteIds.some((id) => id === null)) {
      existing = await discoverNotes(settings, gapCards);
      const unresolved = missing.filter((card) => !existing.has(card.id));
      if (unresolved.length) throw new Error(`${unresolved.length} card${unresolved.length === 1 ? '' : 's'} could not be added to Anki. No duplicate was created; retry after checking the Anki note type.`);
    } else {
      const added = await notesInfo(settings, noteIds.filter((id): id is number => typeof id === 'number'));
      for (const note of added) {
        const trackrId = noteTrackrCardId(note);
        const source = missing.find((card) => card.id === trackrId || ankiTagPart(card.id) === trackrId);
        if (source) existing.set(source.id, note);
      }
    }
  }
  const linked = gapCards.flatMap((card) => {
    const note = existing.get(card.id);
    return note ? [{ cardId: card.id, noteId: note.noteId, cardIds: note.cards }] : [];
  });
  if (linked.length !== gapCards.length) throw new Error('Anki confirmed only part of the card batch. Trackr did not mark the unconfirmed cards as sent.');
  return linked;
}

export async function readAnkiGapProgress(settings: AnkiConnectSettings, cards: RetentionCard[]): Promise<AnkiCardProgress[]> {
  const gapCards = cards.filter((card) => card.gapId && card.status !== 'archived');
  const notes = await discoverNotes(settings, gapCards);
  const allCardIds = [...new Set([...notes.values()].flatMap((note) => note.cards))];
  const info: AnkiCardInfo[] = [];
  const due = new Map<number, boolean>();
  const reviews = await reviewsForCardIds(settings, allCardIds);
  for (const ids of chunk(allCardIds)) {
    let cardInfo: AnkiCardInfo[];
    try {
      cardInfo = await invokeAnki<AnkiCardInfo[]>(settings, 'cardsInfo', { cards: ids, fields: ['prop:r', 'prop:s', 'prop:d'], retrieved_info_mode: 'COMPACT' });
    } catch {
      cardInfo = await invokeAnki<AnkiCardInfo[]>(settings, 'cardsInfo', { cards: ids });
    }
    info.push(...cardInfo);
    try {
      const dueValues = await invokeAnki<boolean[]>(settings, 'areDue', { cards: ids });
      ids.forEach((id, index) => due.set(id, dueValues[index] ?? false));
    } catch {
      // Older AnkiConnect installs may not expose areDue. Missing due state is
      // intentionally treated as unknown, never as evidence for resolving.
    }
  }
  const infoById = new Map(info.map((card) => [card.cardId, card]));
  return gapCards.map((trackrCard) => {
    const note = notes.get(trackrCard.id);
    if (!note) return { trackrCardId: trackrCard.id, cardIds: [], reviews: [], missing: true };
    const cardId = note.cards[0];
    return {
      trackrCardId: trackrCard.id,
      noteId: note.noteId,
      cardIds: note.cards,
      card: cardId === undefined ? undefined : infoById.get(cardId),
      reviews: note.cards.flatMap((id) => reviews.get(id) ?? []).sort((a, b) => a.id - b.id),
      due: cardId === undefined ? undefined : due.get(cardId),
      missing: note.cards.length === 0
    };
  });
}

/**
 * Reads absolute review-time totals for every Trackr Surgery gap card that has
 * ever been linked to Anki. Stored card IDs keep historical time attributable
 * even if a note is later archived or moved to another deck.
 */
export async function readAnkiStudyTime(
  settings: AnkiConnectSettings,
  cards: RetentionCard[],
  rolloverHour = 4,
  timeZone = 'Europe/Prague'
): Promise<AnkiDailyStudyTime[]> {
  const trackrGapCards = cards.filter((card) => card.gapId && (card.id.startsWith('anki-gap-') || !!card.anki));
  if (!trackrGapCards.length) return [];
  const notes = await discoverNotes(settings, trackrGapCards);
  const cardIds = [...new Set([
    ...trackrGapCards.flatMap((card) => card.anki?.cardIds ?? []),
    ...[...notes.values()].flatMap((note) => note.cards)
  ])];
  if (!cardIds.length) return [];
  const reviews = await reviewsForCardIds(settings, cardIds);
  return summarizeAnkiReviewTime([...reviews.values()].flat(), rolloverHour, timeZone);
}
