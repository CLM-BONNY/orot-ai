import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReadingDatabase, completedPageIds, ensureProfile, resumeFraction, saveResume, setCompletion, visitPage } from './reading-store';

const page = { id: 'CH01-P01', revision: `sha256:${'a'.repeat(64)}` };
let db: ReadingDatabase;

beforeEach(() => { db = new ReadingDatabase(`reading-test-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); });

describe('persistent reading records', () => {
  it('creates one local profile even with concurrent initialization', async () => {
    const profiles = await Promise.all(Array.from({ length: 12 }, () => ensureProfile(db)));
    expect(new Set(profiles.map(p => p.id)).size).toBe(1);
    expect(await db.profiles.count()).toBe(1);
  });

  it('visiting never counts as completing a page', async () => {
    const p = await ensureProfile(db);
    const record = await visitPage(p.id, page, db);
    expect(record.state).toBe('started');
    expect(record.completed_at).toBeNull();
    expect(completedPageIds([page], [record]).size).toBe(0);
  });

  it('concurrent visits do not create duplicate page/revision records', async () => {
    const p = await ensureProfile(db);
    await Promise.all(Array.from({ length: 10 }, () => visitPage(p.id, page, db)));
    expect(await db.readingProgress.count()).toBe(1);
  });

  it('preserves completion and its timestamp when a page is revisited', async () => {
    const p = await ensureProfile(db);
    const complete = await setCompletion(p.id, page, true, db);
    const revisit = await visitPage(p.id, page, db);
    expect(revisit).toEqual(complete);
  });

  it('undoing completion preserves the record and clears completed_at', async () => {
    const p = await ensureProfile(db);
    const complete = await setCompletion(p.id, page, true, db);
    const undone = await setCompletion(p.id, page, false, db);
    expect(undone.id).toBe(complete.id);
    expect(undone.state).toBe('started');
    expect(undone.completed_at).toBeNull();
    expect(await db.readingProgress.count()).toBe(1);
  });

  it('keeps progress and resume after closing and reopening IndexedDB', async () => {
    const p = await ensureProfile(db);
    await setCompletion(p.id, page, true, db);
    await saveResume(p.id, page, 0.63, db);
    const name = db.name;
    db.close();
    db = new ReadingDatabase(name);
    expect((await ensureProfile(db)).id).toBe(p.id);
    const record = await db.readingProgress.toArray();
    expect(completedPageIds([page], record).has(page.id)).toBe(true);
    expect((await db.resume.get(p.id))?.scroll_fraction).toBe(0.63);
  });

  it('retains old completion but requires reading the revised page again', async () => {
    const p = await ensureProfile(db);
    await setCompletion(p.id, page, true, db);
    const revised = { ...page, revision: `sha256:${'b'.repeat(64)}` };
    await visitPage(p.id, revised, db);
    const records = await db.readingProgress.toArray();
    expect(records.length).toBe(2);
    expect(completedPageIds([revised], records).size).toBe(0);
    expect(completedPageIds([page], records).size).toBe(1);
  });

  it('restores a position only for the exact page revision', async () => {
    const p = await ensureProfile(db);
    const saved = await saveResume(p.id, page, 0.5, db);
    expect(resumeFraction(page, saved)).toBe(0.5);
    expect(resumeFraction({ ...page, revision: `sha256:${'b'.repeat(64)}` }, saved)).toBe(0);
    expect(resumeFraction({ ...page, id: 'CH01-P02' }, saved)).toBe(0);
  });

  it('bounds scroll fractions and rejects non-finite data', async () => {
    const p = await ensureProfile(db);
    expect((await saveResume(p.id, page, 2, db)).scroll_fraction).toBe(1);
    expect((await saveResume(p.id, page, -1, db)).scroll_fraction).toBe(0);
    await expect(saveResume(p.id, page, NaN, db)).rejects.toThrow();
  });

  it('does not write records with an unknown owner', async () => {
    await expect(visitPage('missing', page, db)).rejects.toThrow();
    await expect(saveResume('missing', page, 0.5, db)).rejects.toThrow();
    expect(await db.readingProgress.count()).toBe(0);
    expect(await db.resume.count()).toBe(0);
  });
});
