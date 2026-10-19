import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureProfile, ReadingDatabase } from './reading-store';
import { questionKey, saveNote, setStar, submitAttempt, submitSelfAssessment, wrongAnswerGroups } from './practice-store';
import type { ChoiceQuestion, ReflectionQuestion } from './types';

const question: ChoiceQuestion = { id: 'CH01-Q01', revision: `sha256:${'a'.repeat(64)}`, origin: 'authored', content_version: '1.0.0', format: 'single_choice',
  chapter_ids: ['CH01'], concept_ids: ['rag'], source_page_ids: ['CH01-P01'], prompt_markdown: 'RAG의 설명은?', category: '개념 구분', difficulty: 'not_rated',
  options: ['모델', '검색과 생성', '손실', '보장'].map((text,i) => ({ id: `CH01-Q01:${String.fromCharCode(65+i)}`, text })), correct_option_id: 'CH01-Q01:B', explanation_markdown: 'RAG는 검색과 생성을 연결한다.', generation_id: null };
const reflection: ReflectionQuestion = { id: 'CH01-R01', revision: `sha256:${'b'.repeat(64)}`, origin: 'authored', content_version: '1.0.0', format: 'self_explanation', chapter_ids: ['CH01'], concept_ids: ['rag'], source_page_ids: ['CH01-P01'], prompt_markdown: '설명해보세요.', category: '인출 연습', difficulty: 'not_rated', expected_answer_markdown: '검색과 생성', grading: 'self_assessment' };
const order = question.options.map(o => o.id);
const aid = (n: number) => `ATT-00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db: ReadingDatabase;
beforeEach(() => { db = new ReadingDatabase(`practice-test-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); });

describe('quiz, memo and review persistence', () => {
  it('upgrades version 1 without losing profile, reading progress or resume', async () => {
    const name = db.name;
    const old = new Dexie(name);
    old.version(1).stores({ profiles: 'id, created_at', readingProgress: 'id, profile_id, &[profile_id+page_ref.id+page_ref.revision]', resume: 'profile_id' });
    await old.table('profiles').put({ id: 'LP-old', display_name: '기존 사용자', created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-18T00:00:00Z' });
    await old.table('readingProgress').put({ id: 'READ-old', profile_id: 'LP-old', page_ref: { id: 'CH01-P01', revision: question.revision }, state: 'completed' });
    await old.table('resume').put({ profile_id: 'LP-old', page_ref: { id: 'CH01-P01', revision: question.revision }, scroll_fraction: .6 });
    old.close();
    await db.open();
    expect((await ensureProfile(db)).id).toBe('LP-old');
    expect(await db.readingProgress.count()).toBe(1);
    expect((await db.resume.get('LP-old'))?.scroll_fraction).toBe(.6);
    expect(await db.attempts.count()).toBe(0);
  });
  it('grades by option ID even when choices are reordered', async () => {
    const p = await ensureProfile(db);
    const a = await submitAttempt(p.id, question, order[1], [...order].reverse(), 120, 'chapter_quiz', aid(1), db);
    expect(a.is_correct).toBe(true);
    expect(a.displayed_option_ids).toEqual([...order].reverse());
  });
  it('rejects missing, repeated and foreign choices before any write', async () => {
    const p = await ensureProfile(db);
    for (const invalid of [order.slice(1), [order[0],order[0],order[2],order[3]], [...order.slice(0,3),'foreign']]) {
      await expect(submitAttempt(p.id, question, order[1], invalid, 5, 'chapter_quiz', aid(1), db)).rejects.toThrow();
    }
    await expect(submitAttempt(p.id, question, 'foreign', order, 5, 'chapter_quiz', aid(1), db)).rejects.toThrow();
    expect(await db.attempts.count()).toBe(0);
  });
  it('repeated submission with the same ID creates one immutable attempt', async () => {
    const p = await ensureProfile(db);
    await Promise.all(Array.from({length:5}, () => submitAttempt(p.id, question, order[0], order, 5, 'chapter_quiz', aid(1), db)));
    expect(await db.attempts.count()).toBe(1);
    await expect(submitAttempt(p.id, question, order[1], order, 5, 'chapter_quiz', aid(1), db)).rejects.toThrow();
  });
  it('keeps the original snapshot when the source question changes', async () => {
    const p = await ensureProfile(db);
    const copy = structuredClone(question);
    await submitAttempt(p.id, copy, order[0], order, 5, 'chapter_quiz', aid(1), db);
    copy.prompt_markdown = '바뀐 문제'; copy.correct_option_id = order[0];
    const saved = await db.attempts.get(aid(1));
    expect(saved?.question_snapshot.prompt_markdown).toBe(question.prompt_markdown);
    expect(saved?.is_correct).toBe(false);
  });
  it('successful retry resolves the queue while preserving the original error', async () => {
    const p = await ensureProfile(db);
    await submitAttempt(p.id, question, order[0], order, 5, 'chapter_quiz', aid(1), db);
    expect(wrongAnswerGroups(await db.attempts.toArray())[0].latest.is_correct).toBe(false);
    await submitAttempt(p.id, question, order[1], order, 5, 'wrong_retry', aid(2), db);
    const group = wrongAnswerGroups(await db.attempts.toArray())[0];
    expect(group.latest.is_correct).toBe(true);
    expect(group.history).toHaveLength(2);
    expect(group.everWrong).toBe(true);
  });
  it('treats another revision as a separate retry target', async () => {
    const p = await ensureProfile(db);
    const revised = { ...question, revision: `sha256:${'c'.repeat(64)}` };
    await submitAttempt(p.id, question, order[0], order, 5, 'chapter_quiz', aid(1), db);
    await submitAttempt(p.id, revised, order[1], order, 5, 'chapter_quiz', aid(2), db);
    const groups = wrongAnswerGroups(await db.attempts.toArray());
    expect(groups).toHaveLength(1);
    expect(questionKey(groups[0].latest.question_ref)).toBe(questionKey(question));
    expect(groups[0].latest.is_correct).toBe(false);
  });
  it('keeps stars unique per revision and supports removing and adding them', async () => {
    const p = await ensureProfile(db);
    await Promise.all(Array.from({length:5}, () => setStar(p.id, question, true, db)));
    expect(await db.bookmarks.count()).toBe(1);
    await setStar(p.id, { ...question, revision: `sha256:${'c'.repeat(64)}` }, true, db);
    await setStar(p.id, question, false, db);
    expect(await db.bookmarks.count()).toBe(1);
    await setStar(p.id, question, true, db);
    expect(await db.bookmarks.count()).toBe(2);
  });
  it('edits a concept note in place and preserves its creation time', async () => {
    const p = await ensureProfile(db);
    const target = { kind:'concept' as const, id:'rag' };
    const old = await saveNote(p.id, target, '검색과 생성', undefined, db);
    const updated = await saveNote(p.id, target, '검색한 근거를 생성에 활용', old.id, db);
    expect(updated.id).toBe(old.id); expect(updated.created_at).toBe(old.created_at);
    expect(updated.body_markdown).toContain('근거'); expect(await db.notes.count()).toBe(1);
    await expect(saveNote(p.id, target, '   ', undefined, db)).rejects.toThrow();
  });
  it('does not allow a note to silently change its source or owner', async () => {
    const p = await ensureProfile(db);
    const n = await saveNote(p.id, {kind:'concept',id:'rag'}, '기록', undefined, db);
    await expect(saveNote(p.id, {kind:'concept',id:'llm'}, '다름', n.id, db)).rejects.toThrow();
    await expect(saveNote('missing', n.target, '다름', n.id, db)).rejects.toThrow();
  });
  it('stores explanation self-assessment separately from objective correctness', async () => {
    const p = await ensureProfile(db);
    const id = `SELF-${crypto.randomUUID()}`;
    await submitSelfAssessment(p.id, reflection, '자료를 검색해 답변한다.', 'partial', id, db);
    await submitSelfAssessment(p.id, reflection, '자료를 검색해 답변한다.', 'partial', id, db);
    expect(await db.attempts.count()).toBe(0);
    expect(await db.selfAssessments.count()).toBe(1);
    await expect(submitSelfAssessment(p.id, reflection, '', 'partial', `SELF-${crypto.randomUUID()}`, db)).rejects.toThrow();
  });
  it('persists all four record types after closing and reopening the database', async () => {
    const p = await ensureProfile(db);
    await submitAttempt(p.id, question, order[0], order, 5, 'chapter_quiz', aid(1), db);
    await setStar(p.id, reflection, true, db);
    await saveNote(p.id, {kind:'concept',id:'rag'}, '메모', undefined, db);
    await submitSelfAssessment(p.id, reflection, '내 설명', 'again', `SELF-${crypto.randomUUID()}`, db);
    const name = db.name; db.close(); db = new ReadingDatabase(name);
    expect(await db.attempts.count()).toBe(1); expect(await db.bookmarks.count()).toBe(1);
    expect(await db.notes.count()).toBe(1); expect(await db.selfAssessments.count()).toBe(1);
  });
  it('rejects unknown owners for every write', async () => {
    await expect(submitAttempt('missing', question, order[0], order, 5, 'chapter_quiz', aid(1), db)).rejects.toThrow();
    await expect(setStar('missing', question, true, db)).rejects.toThrow();
    await expect(saveNote('missing', {kind:'concept',id:'rag'}, '메모', undefined, db)).rejects.toThrow();
    await expect(submitSelfAssessment('missing', reflection, '설명', 'again', `SELF-${crypto.randomUUID()}`, db)).rejects.toThrow();
  });
});
