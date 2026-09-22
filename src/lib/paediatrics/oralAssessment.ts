import type { Mastery, TopicProgress } from './paediatricsSchema';

export const ORAL_DOMAINS = [
  { key: 'coverage', label: 'Topic coverage' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'independence', label: 'Independent recall' },
  { key: 'clinicalReasoning', label: 'Clinical reasoning' },
  { key: 'propedeutics', label: 'Propedeutics' }
] as const;
export type OralDomain = typeof ORAL_DOMAINS[number]['key'];
export type OralAssessment = {
  ratings: Record<OralDomain, Mastery>;
  safetyCriticalError: boolean;
  evidence: string;
  assessedAt?: string;
};
export const ORAL_BANDS = [
  { key: 'unassessed', label: 'Not assessed', range: '—', color: '#343944' },
  { key: 'weak', label: 'Weak', range: '0–7', color: '#a74759' },
  { key: 'prompted', label: 'Needs help', range: '8–11', color: '#b67432' },
  { key: 'passable', label: 'Passable', range: '12–15', color: '#928039' },
  { key: 'solid', label: 'Solid', range: '16–18', color: '#377e91' },
  { key: 'secure', label: 'Secure', range: '19–20', color: '#328c69' }
] as const;

export function validateOralAssessment(value: unknown): OralAssessment {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value) || Object.keys(value).some(k => !['ratings', 'safetyCriticalError', 'evidence', 'assessedAt'].includes(k)) || !object(value.ratings)) throw new Error('oralAssessment must contain ratings, safetyCriticalError and evidence.');
  const ratings = value.ratings;
  if (Object.keys(ratings).length !== ORAL_DOMAINS.length || ORAL_DOMAINS.some(({ key }) => !Number.isInteger(ratings[key]) || Number(ratings[key]) < 0 || Number(ratings[key]) > 4)) throw new Error('Each oral assessment domain must be an integer from 0 to 4.');
  if (typeof value.safetyCriticalError !== 'boolean' || typeof value.evidence !== 'string' || !value.evidence.trim() || value.evidence.length > 1500) throw new Error('Oral assessment requires a safety flag and concise evidence (at most 1500 characters).');
  if (value.assessedAt !== undefined && (typeof value.assessedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.assessedAt) || !Number.isFinite(Date.parse(value.assessedAt)))) throw new Error('Oral assessment date must be an ISO timestamp.');
  return structuredClone(value) as OralAssessment;
}

export function scoreOralAssessment(assessment: OralAssessment) {
  const values = ORAL_DOMAINS.map(({ key }) => assessment.ratings[key]);
  const raw = values.reduce<number>((sum, n) => sum + n, 0);
  const caps: Array<{ max: number; reason: string }> = [];
  if (assessment.safetyCriticalError) caps.push({ max: 7, reason: 'Safety-critical error' });
  if (values.some(n => n === 0)) caps.push({ max: 7, reason: 'An essential area was absent' });
  if (assessment.ratings.independence <= 1) caps.push({ max: 7, reason: 'Answer depended on substantial help' });
  if (values.some(n => n === 1)) caps.push({ max: 11, reason: 'An essential area remains weak' });
  if (assessment.ratings.independence === 2) caps.push({ max: 11, reason: 'Material prompting was needed' });
  if (values.some(n => n === 2)) caps.push({ max: 15, reason: 'An essential area remains incomplete' });
  const score = Math.min(raw, ...caps.map(cap => cap.max));
  const band = ORAL_BANDS[score < 8 ? 1 : score < 12 ? 2 : score < 16 ? 3 : score < 19 ? 4 : 5];
  return { score, raw, band, limits: caps.filter(cap => cap.max < raw).map(cap => cap.reason) };
}

export function oralLegacyMastery(assessment: OralAssessment): Mastery {
  const { score } = scoreOralAssessment(assessment);
  return score < 8 ? 1 : score < 12 ? 2 : score < 19 ? 3 : 4;
}

export function oralSummary(topic: Pick<TopicProgress, 'mastery' | 'oralAssessment'>) {
  if (topic.oralAssessment) {
    const result = scoreOralAssessment(topic.oralAssessment);
    return { ...result, label: `${result.score}/20 · ${result.band.label}`, short: `${result.score}/20`, detailed: true };
  }
  const band = ORAL_BANDS[topic.mastery === 0 ? 0 : topic.mastery === 1 ? 1 : topic.mastery === 2 ? 2 : topic.mastery === 3 ? 3 : 5];
  return { score: undefined, raw: undefined, band, limits: [] as string[], label: topic.mastery ? `Legacy ${topic.mastery}/4 · detailed assessment missing` : 'Not assessed', short: topic.mastery ? `${topic.mastery}/4` : '—', detailed: false };
}

/** A sorting estimate for old records only; never display this as a measured /20 score. */
export function oralPriority(topic: Pick<TopicProgress, 'mastery' | 'oralAssessment'>) {
  return oralSummary(topic).score ?? [0, 4, 10, 14, 20][topic.mastery];
}

export const ORAL_ASSESSMENT_POLICY = `ORAL MASTERY — EVIDENCE-BASED 20-POINT STUDY RUBRIC
Every completed full-topic Pass 0, Pass 1, Pass 2 or broad later oral review must include topic.oralAssessment. A review outcome alone does not colour the mastery map. In Pass 0, score only the cold opening answer and neutral examiner follow-ups before teaching; the later guided acquisition does not change that score. Narrow gap practice and card work do not establish a full-topic score. If an essential area has not been assessed, use a relevant uncued follow-up before teaching or closing; do not invent a rating from a short summary or fill every domain with a default 2 or 3.
Rate five areas separately, each 0–4: coverage (required iBook/Notes scope and structure), accuracy (correctness and precision), independence (recall before hints/teaching), clinicalReasoning (age-appropriate application, differential and safe action), propedeutics (relevant examination, terminology and basic interpretation). Use the full scale based on actual performance: 0 = absent/blackout or fundamentally wrong despite a fair opportunity; 1 = major gaps, fragmentary answer or substantial help; 2 = meaningful knowledge but incomplete or materially prompted; 3 = independently pass-level with minor omissions/hesitation; 4 = precise, complete and robust under follow-up. Grade the entire pre-teaching performance: the cold opening answer plus all independently answered neutral examiner follow-ups. An opening omission is not a gap when retrieved correctly on neutral follow-up without hints. Exclude knowledge produced after teaching, correction, content prompting or explanation; it cannot immediately resolve a gap. The evidence string must distinguish independent pre-teaching recall from excluded post-teaching repair and justify each domain. Rate domains from actual performance; never lower individual ratings to satisfy an overall cap. Trackr applies caps separately after rating. Set safetyCriticalError only when an actual safety-critical error occurred.
Trackr calculates the total out of 20. Safety-critical errors, a zero in any essential domain or independence <=1 cap it at 7; a domain at 1 or independence=2 caps it at 11; any domain at 2 caps it at 15. Bands: 0–7 weak, 8–11 needs help, 12–15 passable, 16–18 solid, 19–20 secure. This is a study assessment of observed performance, not a pass probability or guarantee of durable retention. Secure requires robust uncued performance; repeated delayed success strengthens that judgment. Do not avoid low scores or reserve high scores arbitrarily. For Pass 0 keep review.outcome="studied" because it records guided acquisition, even when the pre-teaching score is low or unsafe. From Pass 1 onward keep review.outcome consistent with the evidence: material help means prompted, safety-critical or broadly absent knowledge means failed.
Output oralAssessment:{ratings:{coverage:0,accuracy:0,independence:0,clinicalReasoning:0,propedeutics:0},safetyCriticalError:false,evidence:"Replace all example ratings with observed evidence."}. The zeros here are placeholders, not suggested scores. Omit the old mastery field when supplying oralAssessment; Trackr derives that compatibility band. Confidence remains separate and must not be invented. From Pass 1 onward include specific gaps in their structured fields, not only in assessment evidence; Pass 0 remains gap-free. Narrow gap-only patches omit oralAssessment, and narrow retests must not raise or replace a full-topic score.`;
