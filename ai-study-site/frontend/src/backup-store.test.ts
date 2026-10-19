import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ReadingDatabase, ensureProfile, setCompletion, saveResume } from './reading-store';
import { exportBackup, importBackup, validateBackup } from './backup-store';
import { saveNote, setStar, submitAttempt, submitSelfAssessment } from './practice-store';
import { saveGeneration } from './generation-store';
import bundle from '../../../data-design/data/content-bundle.json';
import generated from '../../ai-review-example.json';
import type { ChoiceQuestion, ReflectionQuestion, ReviewResponse } from './types';
const q = bundle.questions.find(q=>q.format==='single_choice') as ChoiceQuestion;
const reflection = bundle.questions.find(q=>q.format==='self_explanation') as ReflectionQuestion;
const page = {id:bundle.pages[0].id,revision:bundle.pages[0].revision};
let source: ReadingDatabase; let target: ReadingDatabase;
beforeEach(()=>{source=new ReadingDatabase(`backup-source-${crypto.randomUUID()}`); target=new ReadingDatabase(`backup-target-${crypto.randomUUID()}`);});
afterEach(async()=>{await source.delete();await target.delete();});
async function populated() {
  const p=await ensureProfile(source);
  await setCompletion(p.id,page,true,source); await saveResume(p.id,page,.6,source);
  await saveNote(p.id,{kind:'page',...page},'내가 정리한 개념',undefined,source);
  await submitAttempt(p.id,q,q.options[0].id,q.options.map(o=>o.id),100,'chapter_quiz',`ATT-${crypto.randomUUID()}`,source);
  await setStar(p.id,q,true,source);
  await submitSelfAssessment(p.id,reflection,'설명하기','partial',`SELF-${crypto.randomUUID()}`,source);
  await saveGeneration(p.id,generated as ReviewResponse,['rag'],source);
  return exportBackup(p.id,bundle.release_id,source);
}
it('round trips all record types to a new profile and survives a database reopen',async()=>{
  const backup=await populated();const local=await ensureProfile(target);
  await importBackup(backup,local.id,target);
  const name=target.name;target.close();target=new ReadingDatabase(name);
  const restored=await exportBackup(local.id,bundle.release_id,target);
  expect(restored.attempts).toHaveLength(1);expect(restored.generations).toHaveLength(1);expect(restored.generated_questions).toHaveLength(3);
  expect(restored.notes[0].body_markdown).toBe('내가 정리한 개념');expect(restored.bookmarks).toHaveLength(1);
  expect(restored.self_assessments).toHaveLength(1);expect(restored.resume?.scroll_fraction).toBe(.6);
  expect(restored.reading_progress[0].state).toBe('completed');expect(restored.attempts[0].profile_id).toBe(local.id);
});
it('importing the same file twice is idempotent',async()=>{
  const b=await populated();const p=await ensureProfile(target);await importBackup(b,p.id,target);await importBackup(b,p.id,target);
  expect(await target.notes.count()).toBe(1);expect(await target.attempts.count()).toBe(1);expect(await target.generatedQuestions.count()).toBe(3);
});
it('preserves existing records absent from the backup',async()=>{
  const b=await populated();const p=await ensureProfile(target);await saveNote(p.id,{kind:'concept',id:'rag'},'기존 메모',undefined,target);
  await importBackup(b,p.id,target);expect(await target.notes.count()).toBe(2);
});
it('rolls back all changes when any same-ID record conflicts',async()=>{
  const b=await populated();const p=await ensureProfile(target);
  await target.notes.add({...b.notes[0],profile_id:p.id,body_markdown:'다른 내용'});
  await expect(importBackup(b,p.id,target)).rejects.toThrow('취소');
  expect(await target.attempts.count()).toBe(0);expect(await target.generatedQuestions.count()).toBe(0);
  expect((await target.notes.toArray())[0].body_markdown).toBe('다른 내용');
});
it('rejects tampered snapshots even when JSON shape still matches',async()=>{
  const b=await populated();b.attempts[0].question_snapshot.prompt_markdown='변조됨';
  await expect(validateBackup(b)).rejects.toThrow();
});
it('rejects another owner, invalid grade, duplicated IDs and missing generation links',async()=>{
  const b=await populated();
  const variants=[structuredClone(b),structuredClone(b),structuredClone(b),structuredClone(b)];
  variants[0].notes[0].profile_id=`LP-${crypto.randomUUID()}`;variants[1].attempts[0].is_correct=!variants[1].attempts[0].is_correct;
  variants[2].notes.push(variants[2].notes[0]);variants[3].generated_questions.pop();
  for(const item of variants) await expect(validateBackup(item)).rejects.toThrow();
});
it('merges reading by page revision with newer timestamp and preserves the existing ID',async()=>{
  const b=await populated();const p=await ensureProfile(target);const old=await setCompletion(p.id,page,false,target);
  b.reading_progress[0].updated_at='2099-01-01T00:00:00Z';await importBackup(b,p.id,target);
  const rows=await target.readingProgress.toArray();expect(rows).toHaveLength(1);expect(rows[0].state).toBe('completed');expect(rows[0].id).toBe(old.id);
});
it('rejects unsupported version, extra properties and malformed files',async()=>{
  const b=await populated();
  for(const item of [null,{}, {...b,schema_version:'2.0.0'},{...b,extra:'x'}]) await expect(validateBackup(item)).rejects.toThrow();
});
