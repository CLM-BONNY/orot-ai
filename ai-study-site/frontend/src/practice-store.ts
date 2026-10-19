import { readingDB } from './reading-store';
import type { Attempt, Bookmark, ChoiceQuestion, Note, NoteTarget, Question, ReflectionQuestion, SelfAssessment } from './types';

export const questionKey = (q: { id: string; revision: string }) => `${q.id}@${q.revision}`;
const ref = (q: Question) => ({ id: q.id, revision: q.revision });
const now = () => new Date().toISOString();
export function validateChoice(q: ChoiceQuestion, selected: string, order: string[]) {
  const ids = q.options.map(o => o.id);
  if (ids.length !== 4 || new Set(ids).size !== 4 || !ids.includes(q.correct_option_id)
    || !ids.includes(selected) || order.length !== 4 || new Set(order).size !== 4 || order.some(id => !ids.includes(id))) {
    throw new Error('문제의 선택지 정보를 확인해 주세요.');
  }
}

export async function submitAttempt(profileId: string, question: ChoiceQuestion, selected: string, order: string[], elapsed: number,
  mode: Attempt['mode'], id: string, db = readingDB): Promise<Attempt> {
  validateChoice(question, selected, order);
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('풀이 시간을 확인해 주세요.');
  return db.transaction('rw', db.profiles, db.attempts, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('학습 공간을 열지 못했어요.');
    const existing = await db.attempts.get(id);
    if (existing) {
      if (existing.profile_id !== profileId || questionKey(existing.question_ref) !== questionKey(question)
        || existing.selected_option_id !== selected || JSON.stringify(existing.displayed_option_ids) !== JSON.stringify(order)) throw new Error('이미 다른 풀이로 저장된 기록이에요.');
      return existing;
    }
    const record: Attempt = { id, profile_id: profileId, question_ref: ref(question), question_snapshot: structuredClone(question),
      selected_option_id: selected, displayed_option_ids: [...order], is_correct: selected === question.correct_option_id,
      submitted_at: now(), elapsed_ms: Math.round(elapsed), mode };
    await db.attempts.add(record);
    return record;
  });
}

export async function setStar(profileId: string, question: Question, starred: boolean, db = readingDB): Promise<void> {
  return db.transaction('rw', db.profiles, db.bookmarks, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('학습 공간을 열지 못했어요.');
    const old = await db.bookmarks.where('[profile_id+question_ref.id+question_ref.revision]').equals([profileId, question.id, question.revision]).first();
    if (!starred) { if (old) await db.bookmarks.delete(old.id); return; }
    if (old) return;
    const record: Bookmark = { id: `BKM-${crypto.randomUUID()}`, profile_id: profileId, question_ref: ref(question), question_snapshot: structuredClone(question), created_at: now() };
    await db.bookmarks.add(record);
  });
}

export async function saveNote(profileId: string, target: NoteTarget, body: string, id?: string, db = readingDB): Promise<Note> {
  const text = body.trim();
  if (!text || text.length > 20000) throw new Error('메모를 1~20,000자로 적어 주세요.');
  return db.transaction('rw', db.profiles, db.notes, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('학습 공간을 열지 못했어요.');
    const old = id ? await db.notes.get(id) : undefined;
    if (id && (!old || old.profile_id !== profileId || JSON.stringify(old.target) !== JSON.stringify(target))) throw new Error('메모의 연결 정보를 확인해 주세요.');
    const record: Note = { id: old?.id || `NOTE-${crypto.randomUUID()}`, profile_id: profileId, target: structuredClone(target),
      quote_anchor: null, body_markdown: text, created_at: old?.created_at || now(), updated_at: now() };
    await db.notes.put(record);
    return record;
  });
}

export async function submitSelfAssessment(profileId: string, question: ReflectionQuestion, response: string, rating: SelfAssessment['rating'], id: string, db = readingDB): Promise<SelfAssessment> {
  if (!response.trim() || response.length > 20000 || !['again', 'partial', 'understood'].includes(rating)) throw new Error('내 설명과 자기평가를 확인해 주세요.');
  return db.transaction('rw', db.profiles, db.selfAssessments, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('학습 공간을 열지 못했어요.');
    const existing = await db.selfAssessments.get(id);
    if (existing) {
      if (existing.profile_id !== profileId || questionKey(existing.question_ref) !== questionKey(question) || existing.response_markdown !== response.trim() || existing.rating !== rating) throw new Error('이미 다른 응답으로 저장된 기록이에요.');
      return existing;
    }
    const record: SelfAssessment = { id, profile_id: profileId, question_ref: ref(question), question_snapshot: structuredClone(question), response_markdown: response.trim(), rating, submitted_at: now() };
    await db.selfAssessments.add(record);
    return record;
  });
}

export function wrongAnswerGroups(attempts: Attempt[]) {
  const groups = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const key = questionKey(attempt.question_ref);
    groups.set(key, [...(groups.get(key) || []), attempt]);
  }
  return [...groups.values()].map(history => {
    history.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at) || a.id.localeCompare(b.id));
    return { history, latest: history[history.length - 1], everWrong: history.some(a => !a.is_correct) };
  }).filter(g => g.everWrong).sort((a, b) => b.latest.submitted_at.localeCompare(a.latest.submitted_at) || b.latest.id.localeCompare(a.latest.id));
}
