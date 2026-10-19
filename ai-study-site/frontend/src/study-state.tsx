import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Curriculum, Profile, ReadingProgress, Resume, PageRef } from './types';
import { readingDB, ensureProfile, visitPage, setCompletion, saveResume, completedPageIds } from './reading-store';

type Study = {
  curriculum: Curriculum | null; contentError: string; reload: () => void;
  ready: boolean; profile: Profile | null; records: ReadingProgress[]; resume: Resume | undefined;
  storageError: string; completed: Set<string>;
  visit: (page: PageRef) => Promise<void>;
  complete: (page: PageRef, value: boolean) => Promise<void>;
  savePosition: (page: PageRef, fraction: number) => Promise<void>;
};
const StudyContext = createContext<Study | null>(null);

export function StudyProvider({ children }: { children: ReactNode }) {
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [contentError, setContentError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [records, setRecords] = useState<ReadingProgress[]>([]);
  const [resume, setResume] = useState<Resume>();
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setContentError('');
    fetch('/content/curriculum.json', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<Curriculum>; })
      .then(setCurriculum).catch(e => { if (e.name !== 'AbortError') setContentError('학습 목차를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.'); });
    return () => controller.abort();
  }, [epoch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const localProfile = await ensureProfile();
        const [progress, last] = await Promise.all([
          readingDB.readingProgress.where('profile_id').equals(localProfile.id).toArray(),
          readingDB.resume.get(localProfile.id),
        ]);
        if (!cancelled) { setProfile(localProfile); setRecords(progress); setResume(last); }
      } catch {
        if (!cancelled) setStorageError('이 브라우저에서 학습 기록을 저장하지 못했어요. 글은 계속 읽을 수 있어요.');
      } finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((record: ReadingProgress) => setRecords(prev => [...prev.filter(r => r.id !== record.id), record]), []);
  const storageFailure = () => { setStorageError('학습 기록을 저장하지 못했어요. 브라우저 저장 공간과 설정을 확인해 주세요.'); };
  const visit = useCallback(async (page: PageRef) => {
    if (!profile) return;
    try { update(await visitPage(profile.id, page)); } catch { storageFailure(); }
  }, [profile, update]);
  const complete = useCallback(async (page: PageRef, value: boolean) => {
    if (!profile) return;
    try { update(await setCompletion(profile.id, page, value)); }
    catch (error) { storageFailure(); throw error; }
  }, [profile, update]);
  const savePosition = useCallback(async (page: PageRef, fraction: number) => {
    if (!profile) return;
    try { setResume(await saveResume(profile.id, page, fraction)); } catch { storageFailure(); }
  }, [profile]);
  const completed = useMemo(() => completedPageIds(curriculum?.pages || [], records), [curriculum, records]);

  return <StudyContext.Provider value={{ curriculum, contentError, reload: () => setEpoch(e => e+1), ready,
    profile, records, resume, storageError, completed, visit, complete, savePosition }}>{children}</StudyContext.Provider>;
}

export function useStudy() {
  const value = useContext(StudyContext);
  if (!value) throw new Error('StudyProvider is required');
  return value;
}
