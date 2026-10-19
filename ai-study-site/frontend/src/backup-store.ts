import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import contract from '../../../data-design/schema/data-contract.schema.json';
import { readingDB, type ReadingDatabase } from './reading-store';
import { questionRevision } from './generation-store';
import { questionKey, validateChoice } from './practice-store';
import type { Attempt, Bookmark, ChoiceQuestion, Generation, Note, Profile, ReadingProgress, Resume, SelfAssessment } from './types';

export type Backup = { kind: 'learning_backup'; schema_version: '1.0.0'; content_release_id: string; exported_at: string;
  profile: Profile; attempts: Attempt[]; notes: Note[]; bookmarks: Bookmark[]; reading_progress: ReadingProgress[];
  resume: Resume | null; self_assessments: SelfAssessment[]; generations: Generation[]; generated_questions: ChoiceQuestion[] };
const ajv = new Ajv2020({ allErrors: false, strictTypes: false });
addFormats(ajv);
const shape = ajv.compile({ $defs: contract.$defs, $ref: '#/$defs/backup' });
const arrays = ['attempts','notes','bookmarks','reading_progress','self_assessments','generations','generated_questions'] as const;
const fail = () => { throw new Error('백업의 형식이나 기록 연결이 올바르지 않아요. 원본 파일을 확인해 주세요.'); };
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable)}]` : v && typeof v === 'object'
  ? `{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}` : JSON.stringify(v);

export async function validateBackup(value: unknown): Promise<Backup> {
  if (!shape(value)) return fail();
  const b = value as Backup;
  if (b.schema_version !== '1.0.0') return fail();
  for (const name of arrays) {
    const records = b[name];
    if (new Set(records.map(r=>r.id)).size !== records.length) return fail();
    if (name !== 'generated_questions' && records.some(r=>'profile_id' in r && r.profile_id !== b.profile.id)) return fail();
  }
  if (b.resume && b.resume.profile_id !== b.profile.id) return fail();
  const unique = (keys: string[]) => { if (new Set(keys).size !== keys.length) fail(); };
  unique(b.reading_progress.map(r=>questionKey(r.page_ref)));
  unique(b.bookmarks.map(r=>questionKey(r.question_ref)));
  unique(b.generations.map(g=>g.request_id));
  for (const r of b.reading_progress) if ((r.state === 'completed') !== (r.completed_at !== null)) return fail();
  const questions = [...b.generated_questions, ...b.attempts.map(r=>r.question_snapshot), ...b.bookmarks.map(r=>r.question_snapshot), ...b.self_assessments.map(r=>r.question_snapshot)];
  for (const q of questions) {
    if (q.format === 'single_choice') validateChoice(q,q.correct_option_id,q.options.map(o=>o.id));
    const { revision, ...body } = q;
    if (await questionRevision(body as Omit<ChoiceQuestion,'revision'>) !== revision) return fail();
  }
  for (const r of [...b.attempts,...b.bookmarks,...b.self_assessments]) if (questionKey(r.question_ref) !== questionKey(r.question_snapshot)) return fail();
  for (const a of b.attempts) {
    validateChoice(a.question_snapshot,a.selected_option_id,a.displayed_option_ids);
    if (a.is_correct !== (a.selected_option_id === a.question_snapshot.correct_option_id)) return fail();
  }
  for (const g of b.generations) {
    const qs = g.question_ids.map(id=>b.generated_questions.find(q=>q.id===id));
    if (qs.some(q=>!q || q.origin !== 'generated' || q.generation_id !== g.id || q.concept_ids.some(c=>!g.concept_ids.includes(c)))
      || g.concept_ids.some(c=>!qs.some(q=>q?.concept_ids.includes(c)))) return fail();
  }
  for (const q of b.generated_questions) if (!b.generations.some(g=>g.id===q.generation_id && g.question_ids.includes(q.id))) return fail();
  return structuredClone(b);
}

export async function exportBackup(profileId: string, release: string, db = readingDB): Promise<Backup> {
  const raw = await db.transaction('r', db.tables, async () => {
    const profile = await db.profiles.get(profileId);
    if (!profile) throw new Error('학습 공간을 먼저 열어 주세요.');
    const [attempts,notes,bookmarks,reading_progress,self_assessments,generations,resume] = await Promise.all([
      db.attempts.where('profile_id').equals(profileId).toArray(), db.notes.where('profile_id').equals(profileId).toArray(),
      db.bookmarks.where('profile_id').equals(profileId).toArray(), db.readingProgress.where('profile_id').equals(profileId).toArray(),
      db.selfAssessments.where('profile_id').equals(profileId).toArray(), db.generations.where('profile_id').equals(profileId).toArray(), db.resume.get(profileId),
    ]);
    const generated_questions = await db.generatedQuestions.bulkGet(generations.flatMap(g=>g.question_ids));
    return { kind:'learning_backup', schema_version:'1.0.0', content_release_id:release, exported_at:new Date().toISOString(), profile,
      attempts,notes,bookmarks,reading_progress,self_assessments,generations,resume:resume || null,generated_questions };
  });
  return validateBackup(raw);
}

export async function importBackup(value: unknown, profileId: string, db: ReadingDatabase = readingDB): Promise<void> {
  // Validate outside the transaction: SHA-256 promises may otherwise let IndexedDB auto-commit.
  const b = await validateBackup(value);
  await db.transaction('rw',db.tables,async () => {
    if (!await db.profiles.get(profileId)) throw new Error('학습 공간을 먼저 열어 주세요.');
    const conflict = () => { throw new Error('기존 기록과 내용이 다른 ID가 있어 가져오기를 취소했어요. 현재 기록은 보존돼요.'); };
    for (const name of ['attempts','notes','bookmarks','self_assessments','generations','generated_questions'] as const) {
      const table = db.table(name === 'self_assessments' ? 'selfAssessments' : name === 'generated_questions' ? 'generatedQuestions' : name);
      for (const record of b[name]) {
        const incoming = name === 'generated_questions' ? record : {...record,profile_id:profileId};
        const existing = await table.get(record.id);
        if (existing) { if (stable(existing) !== stable(incoming)) conflict(); continue; }
        if (name === 'bookmarks') {
          const r = record as Bookmark;
          if (await db.bookmarks.where('[profile_id+question_ref.id+question_ref.revision]').equals([profileId,r.question_ref.id,r.question_ref.revision]).count()) continue;
        }
        if (name === 'generations' && await db.generations.where('[profile_id+request_id]').equals([profileId,(record as Generation).request_id]).count()) conflict();
        await table.add(incoming);
      }
    }
    for (const r of b.reading_progress) {
      const byId = await db.readingProgress.get(r.id);
      if (byId && (byId.profile_id !== profileId || questionKey(byId.page_ref) !== questionKey(r.page_ref))) conflict();
      const existing = await db.readingProgress.where('[profile_id+page_ref.id+page_ref.revision]').equals([profileId,r.page_ref.id,r.page_ref.revision]).first();
      if (!existing || Date.parse(r.updated_at) > Date.parse(existing.updated_at)) await db.readingProgress.put({...r,id:existing?.id || r.id,profile_id:profileId});
    }
    const resume = await db.resume.get(profileId);
    if (b.resume && (!resume || Date.parse(b.resume.updated_at)>Date.parse(resume.updated_at))) await db.resume.put({...b.resume,profile_id:profileId});
  });
}
