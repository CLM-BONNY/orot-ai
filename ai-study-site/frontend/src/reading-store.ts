import Dexie, { type Table } from 'dexie';
import type { PageRef, Profile, ReadingProgress, Resume, Attempt, Note, Bookmark, SelfAssessment, Generation, ChoiceQuestion } from './types';

export class ReadingDatabase extends Dexie {
  profiles!: Table<Profile, string>;
  readingProgress!: Table<ReadingProgress, string>;
  resume!: Table<Resume, string>;
  attempts!: Table<Attempt, string>;
  notes!: Table<Note, string>;
  bookmarks!: Table<Bookmark, string>;
  selfAssessments!: Table<SelfAssessment, string>;
  generations!: Table<Generation, string>;
  generatedQuestions!: Table<ChoiceQuestion, string>;

  constructor(name = 'orot-ai-learning') {
    super(name);
    this.version(1).stores({
      profiles: 'id, created_at',
      readingProgress: 'id, profile_id, &[profile_id+page_ref.id+page_ref.revision]',
      resume: 'profile_id',
    });
    this.version(2).stores({
      attempts: 'id, profile_id, [profile_id+question_ref.id+question_ref.revision], submitted_at',
      notes: 'id, profile_id, [profile_id+target.kind+target.id], updated_at',
      bookmarks: 'id, profile_id, &[profile_id+question_ref.id+question_ref.revision]',
      selfAssessments: 'id, profile_id, [profile_id+question_ref.id+question_ref.revision], submitted_at',
    });
    this.version(3).stores({
      generations: 'id, profile_id, &[profile_id+request_id], created_at',
      generatedQuestions: 'id, generation_id',
    });
  }
}

export const readingDB = new ReadingDatabase();
const refKey = '[profile_id+page_ref.id+page_ref.revision]';

export async function ensureProfile(db = readingDB): Promise<Profile> {
  return db.transaction('rw', db.profiles, async () => {
    const existing = await db.profiles.toCollection().first();
    if (existing) return existing;
    const now = new Date().toISOString();
    const profile: Profile = { id: `LP-${crypto.randomUUID()}`, display_name: '나의 학습 공간', created_at: now, updated_at: now };
    await db.profiles.add(profile);
    return profile;
  });
}

export async function visitPage(profileId: string, page: PageRef, db = readingDB): Promise<ReadingProgress> {
  return db.transaction('rw', db.profiles, db.readingProgress, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('Unknown local profile');
    const existing = await db.readingProgress.where(refKey).equals([profileId, page.id, page.revision]).first();
    if (existing) return existing;
    const record: ReadingProgress = { id: `READ-${crypto.randomUUID()}`, profile_id: profileId,
      page_ref: page, state: 'started', completed_at: null, updated_at: new Date().toISOString() };
    await db.readingProgress.add(record);
    return record;
  });
}

export async function setCompletion(profileId: string, page: PageRef, complete: boolean, db = readingDB): Promise<ReadingProgress> {
  return db.transaction('rw', db.profiles, db.readingProgress, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('Unknown local profile');
    const existing = await db.readingProgress.where(refKey).equals([profileId, page.id, page.revision]).first();
    const now = new Date().toISOString();
    const record: ReadingProgress = { id: existing?.id || `READ-${crypto.randomUUID()}`, profile_id: profileId,
      page_ref: page, state: complete ? 'completed' : 'started',
      completed_at: complete ? (existing?.completed_at || now) : null, updated_at: now };
    await db.readingProgress.put(record);
    return record;
  });
}

export async function saveResume(profileId: string, page: PageRef, fraction: number, db = readingDB): Promise<Resume> {
  if (!Number.isFinite(fraction)) throw new Error('Invalid scroll fraction');
  const record: Resume = { profile_id: profileId, page_ref: page,
    scroll_fraction: Math.min(1, Math.max(0, fraction)), updated_at: new Date().toISOString() };
  await db.transaction('rw', db.profiles, db.resume, async () => {
    if (!await db.profiles.get(profileId)) throw new Error('Unknown local profile');
    await db.resume.put(record);
  });
  return record;
}

export function completedPageIds(pages: PageRef[], records: ReadingProgress[]): Set<string> {
  const current = new Map(pages.map(p => [p.id, p.revision]));
  return new Set(records.filter(r => r.state === 'completed' && current.get(r.page_ref.id) === r.page_ref.revision).map(r => r.page_ref.id));
}

export function resumeFraction(page: PageRef, saved: Resume | undefined): number {
  return saved?.page_ref.id === page.id && saved.page_ref.revision === page.revision
    ? Math.min(1, Math.max(0, saved.scroll_fraction)) : 0;
}
