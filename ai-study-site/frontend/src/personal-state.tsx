import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStudy } from './study-state';
import { readingDB } from './reading-store';
import { saveNote, setStar, submitAttempt, submitSelfAssessment } from './practice-store';
import { saveGeneration } from './generation-store';
import type { Attempt, Bookmark, ChoiceQuestion, Note, NoteTarget, Question, ReflectionQuestion, SelfAssessment, Generation, ReviewResponse } from './types';

type Personal = {
  ready: boolean; error: string; attempts: Attempt[]; notes: Note[]; bookmarks: Bookmark[]; selfAssessments: SelfAssessment[];
  retry: () => void;
  answer: (q: ChoiceQuestion, selected: string, order: string[], elapsed: number, mode: Attempt['mode'], id: string) => Promise<Attempt>;
  reflect: (q: ReflectionQuestion, text: string, rating: SelfAssessment['rating'], id: string) => Promise<SelfAssessment>;
  star: (q: Question, value: boolean) => Promise<void>;
  note: (target: NoteTarget, body: string, id?: string) => Promise<Note>;
  generations: Generation[]; generatedQuestions: ChoiceQuestion[];
  saveReview: (response: ReviewResponse, conceptIds: string[]) => Promise<Generation>;
};
const Context = createContext<Personal | null>(null);

export function PersonalProvider({ children }: { children: ReactNode }) {
  const { profile, ready: studyReady } = useStudy();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [selfAssessments, setSelfAssessments] = useState<SelfAssessment[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [generatedQuestions, setGeneratedQuestions] = useState<ChoiceQuestion[]>([]);
  const refresh = useCallback(async () => {
    if (!profile) throw new Error('브라우저의 학습 저장 공간을 열지 못했어요.');
    const [a, n, b, s, g] = await Promise.all([
      readingDB.attempts.where('profile_id').equals(profile.id).toArray(),
      readingDB.notes.where('profile_id').equals(profile.id).toArray(),
      readingDB.bookmarks.where('profile_id').equals(profile.id).toArray(),
      readingDB.selfAssessments.where('profile_id').equals(profile.id).toArray(),
      readingDB.generations.where('profile_id').equals(profile.id).toArray(),
    ]);
    const generated = (await readingDB.generatedQuestions.bulkGet(g.flatMap(item => item.question_ids))).filter((q): q is ChoiceQuestion => !!q);
    return { a, n, b, s, g, generated };
  }, [profile]);
  const apply = useCallback((data: Awaited<ReturnType<typeof refresh>>) => {
    setAttempts(data.a); setNotes(data.n); setBookmarks(data.b); setSelfAssessments(data.s);
    setGenerations(data.g); setGeneratedQuestions(data.generated);
  }, []);
  useEffect(() => {
    if (!studyReady) return;
    let cancelled = false;
    setReady(false);
    refresh().then(data => { if (!cancelled) { apply(data); setError(''); } })
      .catch(() => { if (!cancelled) setError('학습 기록을 불러오지 못했어요. 브라우저 저장 설정을 확인해 주세요.'); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [studyReady, refresh, apply, epoch]);

  async function write<T>(action: (profileId: string) => Promise<T>): Promise<T> {
    try {
      if (!profile || !ready) throw new Error('학습 기록을 먼저 불러와 주세요.');
      const result = await action(profile.id);
      apply(await refresh()); setError('');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : '기록을 저장하지 못했어요. 다시 시도해 주세요.');
      throw e;
    }
  }
  return <Context.Provider value={{ ready, error, attempts, notes, bookmarks, selfAssessments, generations, generatedQuestions, retry: () => setEpoch(e => e+1),
    answer: (q, selected, order, elapsed, mode, id) => write(p => submitAttempt(p, q, selected, order, elapsed, mode, id)),
    reflect: (q, text, rating, id) => write(p => submitSelfAssessment(p, q, text, rating, id)),
    star: (q, value) => write(p => setStar(p, q, value)),
    note: (target, body, id) => write(p => saveNote(p, target, body, id)),
    saveReview: (response, ids) => write(p => saveGeneration(p, response, ids)),
  }}>{children}</Context.Provider>;
}

export function usePersonal() {
  const value = useContext(Context);
  if (!value) throw new Error('PersonalProvider is required');
  return value;
}
