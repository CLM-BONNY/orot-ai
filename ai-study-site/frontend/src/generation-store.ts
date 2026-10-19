import { readingDB } from './reading-store';
import type { ChoiceQuestion, Generation, ReviewResponse } from './types';
import { validateChoice } from './practice-store';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function questionRevision(question: Omit<ChoiceQuestion, 'revision'>): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(question)));
  return `sha256:${[...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('')}`;
}

export async function saveGeneration(profileId: string, response: ReviewResponse, conceptIds: string[], db = readingDB): Promise<Generation> {
  if (response.kind !== 'review_response' || response.review_status !== 'unreviewed' || !/^GEN-[0-9a-f-]{36}$/.test(response.generation_id)
    || !/^REQ-[0-9a-f-]{36}$/.test(response.request_id) || !response.model || !response.prompt_version
    || response.questions.length !== 3 || new Set(response.questions.map(q => q.id)).size !== 3
    || !conceptIds.length || conceptIds.length > 5 || new Set(conceptIds).size !== conceptIds.length) throw new Error('생성 결과의 형식을 확인해 주세요.');
  const covered = new Set<string>();
  const prompts = new Set<string>();
  for (const q of response.questions) {
    if (q.origin !== 'generated' || q.format !== 'single_choice' || q.generation_id !== response.generation_id
      || !/^GQ-[0-9a-f-]{36}$/.test(q.id) || !q.prompt_markdown.trim() || !q.explanation_markdown.trim()
      || !q.source_page_ids.length || !q.chapter_ids.length || !q.concept_ids.length || q.concept_ids.some(cid => !conceptIds.includes(cid))) throw new Error('생성 문제의 연결 정보를 확인해 주세요.');
    const prompt = q.prompt_markdown.toLowerCase().replace(/\s/g,'');
    if (prompts.has(prompt) || q.options.some((o,i) => o.id !== `${q.id}:${String.fromCharCode(65+i)}` || !o.text.trim())) throw new Error('중복 문제나 잘못된 보기가 있어요.');
    prompts.add(prompt); q.concept_ids.forEach(cid => covered.add(cid));
    validateChoice(q, q.correct_option_id, q.options.map(o => o.id));
    const { revision, ...body } = q;
    if (await questionRevision(body) !== revision) throw new Error('생성 문제가 전송 중 바뀌었어요. 다시 생성해 주세요.');
  }
  if (covered.size !== conceptIds.length) throw new Error('선택한 개념이 빠진 문제가 있어요.');
  return db.transaction('rw', db.profiles, db.generations, db.generatedQuestions, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('학습 공간을 열지 못했어요.');
    const existing = await db.generations.where('[profile_id+request_id]').equals([profileId, response.request_id]).first();
    if (existing) {
      const saved = await Promise.all(existing.question_ids.map(id => db.generatedQuestions.get(id)));
      if (existing.id !== response.generation_id || existing.content_release_id !== response.content_release_id
        || existing.model !== response.model || existing.prompt_version !== response.prompt_version || canonical(existing.concept_ids) !== canonical(conceptIds)
        || saved.some((q,i) => !q || canonical(q) !== canonical(response.questions[i]))) throw new Error('같은 요청에 다른 생성 결과가 있어요.');
      return existing;
    }
    if (await db.generations.get(response.generation_id) || (await db.generatedQuestions.bulkGet(response.questions.map(q => q.id))).some(Boolean)) throw new Error('생성 기록의 ID가 충돌했어요.');
    const record: Generation = { id: response.generation_id, profile_id: profileId, request_id: response.request_id,
      content_release_id: response.content_release_id, concept_ids: [...conceptIds], question_ids: response.questions.map(q => q.id),
      model: response.model, prompt_version: response.prompt_version, review_status: 'unreviewed', created_at: new Date().toISOString() };
    await db.generatedQuestions.bulkAdd(structuredClone(response.questions));
    await db.generations.add(record);
    return record;
  });
}
