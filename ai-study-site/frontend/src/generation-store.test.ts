import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureProfile, ReadingDatabase } from './reading-store';
import { questionRevision, saveGeneration } from './generation-store';
import { setStar, submitAttempt, wrongAnswerGroups } from './practice-store';
import type { ChoiceQuestion, ReviewResponse } from './types';

let db: ReadingDatabase;
beforeEach(()=>{db=new ReadingDatabase(`generation-test-${crypto.randomUUID()}`);});
afterEach(async()=>{await db.delete();});
async function fixture(): Promise<ReviewResponse> {
  const generation_id=`GEN-${crypto.randomUUID()}`;
  const questions=await Promise.all([1,2,3].map(async i=>{
    const id=`GQ-${crypto.randomUUID()}`;
    const q: Omit<ChoiceQuestion,'revision'>={id,format:'single_choice',origin:'generated',content_version:'1.0.0',chapter_ids:['CH01'],concept_ids:['rag'],source_page_ids:['CH01-P01'],prompt_markdown:`복습 질문 ${i}: RAG는?`,category:'AI 복습',difficulty:'beginner',options:['검색과 생성','모델 종류','학습 손실','정확성 보장'].map((text,index)=>({id:`${id}:${String.fromCharCode(65+index)}`,text})),correct_option_id:`${id}:A`,explanation_markdown:'RAG는 검색과 생성을 연결한다.',generation_id};
    return {...q,revision:await questionRevision(q)};
  }));
  return {kind:'review_response',request_id:`REQ-${crypto.randomUUID()}`,content_release_id:`sha256:${'a'.repeat(64)}`,generation_id,model:'local-test-qwen',prompt_version:'review-test',review_status:'unreviewed',questions};
}

describe('durable generated quiz sets',()=>{
  it('upgrades version 2 while preserving notes and quiz history',async()=>{
    const old=new Dexie(db.name);
    old.version(2).stores({profiles:'id, created_at',readingProgress:'id, profile_id, &[profile_id+page_ref.id+page_ref.revision]',resume:'profile_id',attempts:'id, profile_id, [profile_id+question_ref.id+question_ref.revision], submitted_at',notes:'id, profile_id, [profile_id+target.kind+target.id], updated_at',bookmarks:'id, profile_id, &[profile_id+question_ref.id+question_ref.revision]',selfAssessments:'id, profile_id, [profile_id+question_ref.id+question_ref.revision], submitted_at'});
    await old.table('profiles').put({id:'LP-old',display_name:'기존 학습 공간',created_at:'2026-10-18T00:00:00Z',updated_at:'2026-10-18T00:00:00Z'});
    await old.table('notes').put({id:'NOTE-old',profile_id:'LP-old',target:{kind:'concept',id:'rag'},body_markdown:'기존 메모'});
    await old.table('attempts').put({id:'ATT-old',profile_id:'LP-old',question_ref:{id:'CH01-Q01',revision:'old'}});
    old.close(); await db.open();
    expect((await ensureProfile(db)).id).toBe('LP-old');
    expect((await db.notes.get('NOTE-old'))?.body_markdown).toBe('기존 메모');
    expect(await db.attempts.count()).toBe(1); expect(await db.generations.count()).toBe(0);
  });
  it('hashes canonical Unicode content independently of object property order',async()=>{
    const {revision,...q}=(await fixture()).questions[0];
    const reordered=Object.fromEntries(Object.entries(q).reverse()) as Omit<ChoiceQuestion,'revision'>;
    expect(await questionRevision(reordered)).toBe(revision);
  });
  it('saves three questions and their generation as one set, without duplicates on retry',async()=>{
    const p=await ensureProfile(db), response=await fixture();
    const one=await saveGeneration(p.id,response,['rag'],db);
    const two=await saveGeneration(p.id,response,['rag'],db);
    expect(two).toEqual(one); expect(await db.generations.count()).toBe(1); expect(await db.generatedQuestions.count()).toBe(3);
    expect(one.review_status).toBe('unreviewed');
  });
  it('retains a generated set after closing and reopening IndexedDB',async()=>{
    const p=await ensureProfile(db), response=await fixture();
    await saveGeneration(p.id,response,['rag'],db);
    const name=db.name; db.close(); db=new ReadingDatabase(name);
    expect((await db.generations.get(response.generation_id))?.question_ids).toHaveLength(3);
    expect((await db.generatedQuestions.get(response.questions[0].id))?.prompt_markdown).toBe(response.questions[0].prompt_markdown);
  });
  it('rejects a tampered question instead of saving a partial set',async()=>{
    const p=await ensureProfile(db), response=await fixture();
    response.questions[2].explanation_markdown='바뀐 정답 해설';
    await expect(saveGeneration(p.id,response,['rag'],db)).rejects.toThrow();
    expect(await db.generations.count()).toBe(0);expect(await db.generatedQuestions.count()).toBe(0);
  });
  it('rejects missing questions and incomplete requested concept coverage',async()=>{
    const p=await ensureProfile(db), response=await fixture();
    await expect(saveGeneration(p.id,response,['rag','llm'],db)).rejects.toThrow();
    response.questions.pop();
    await expect(saveGeneration(p.id,response,['rag'],db)).rejects.toThrow();
    expect(await db.generatedQuestions.count()).toBe(0);
  });
  it('rejects conflicting results for the same request ID',async()=>{
    const p=await ensureProfile(db), one=await fixture(), two=await fixture();
    await saveGeneration(p.id,one,['rag'],db);two.request_id=one.request_id;
    await expect(saveGeneration(p.id,two,['rag'],db)).rejects.toThrow();
    expect(await db.generatedQuestions.count()).toBe(3);expect(await db.generations.count()).toBe(1);
  });
  it('does not overwrite a question ID from another generated set',async()=>{
    const p=await ensureProfile(db), one=await fixture(), two=await fixture();
    await saveGeneration(p.id,one,['rag'],db);
    const {revision,...body}={...one.questions[0],generation_id:two.generation_id};
    two.questions[0]={...body,revision:await questionRevision(body)};
    await expect(saveGeneration(p.id,two,['rag'],db)).rejects.toThrow();
    expect((await db.generatedQuestions.get(one.questions[0].id))?.generation_id).toBe(one.generation_id);
    expect(await db.generations.count()).toBe(1);
  });
  it('generated questions use normal answer, wrong-retry and star records',async()=>{
    const p=await ensureProfile(db), response=await fixture();
    await saveGeneration(p.id,response,['rag'],db);
    const q=response.questions[0];
    await submitAttempt(p.id,q,q.options[1].id,q.options.map(o=>o.id),500,'ai_review',`ATT-${crypto.randomUUID()}`,db);
    await setStar(p.id,q,true,db);
    expect(wrongAnswerGroups(await db.attempts.toArray())[0].latest.question_snapshot.generation_id).toBe(response.generation_id);
    expect((await db.bookmarks.toArray())[0].question_snapshot.origin).toBe('generated');
  });
  it('rejects unknown owners without storing any generated question',async()=>{
    await expect(saveGeneration('missing',await fixture(),['rag'],db)).rejects.toThrow();
    expect(await db.generatedQuestions.count()).toBe(0);
  });
});
