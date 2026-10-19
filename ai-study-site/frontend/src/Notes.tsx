import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePersonal } from './personal-state';
import { useStudy } from './study-state';
import { Prose } from './ui';
import type { Note, NoteTarget } from './types';

export function NoteComposer({ target, concepts = [] }: { target: NoteTarget; concepts?: string[] }) {
  const personal = usePersonal();
  const { profile } = useStudy();
  const [body, setBody] = useState('');
  const [concept, setConcept] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await personal.note(concept ? { kind: 'concept', id: concept } : target, body);
      setBody(''); setMessage('메모를 저장했어요. 나의 학습에서 다시 볼 수 있어요.');
    } catch { setError('메모를 저장하지 못했어요. 적은 내용은 그대로 두었어요.'); }
    finally { setBusy(false); }
  }
  const count = personal.notes.filter(n => n.target.kind === target.kind && n.target.id === target.id).length;
  return <details className="note-composer"><summary>내 말로 남기는 개념 메모 <span>{count ? `${count}개 저장됨` : '+'}</span></summary><form onSubmit={e => void save(e)}>
    <label>어디에 남길까요?<select value={concept} onChange={e => setConcept(e.target.value)} disabled={busy}><option value="">{target.kind === 'question' ? '이 문제' : '이 페이지'}</option>{concepts.map(id => <option key={id} value={id}>{id.replaceAll('-', ' ')}</option>)}</select></label>
    <label>개념 메모<textarea value={body} maxLength={20000} rows={4} placeholder="내가 이해한 설명, 헷갈린 점, 떠오른 예시를 적어보세요." disabled={busy} onChange={e => { setBody(e.target.value); setMessage(''); }} /></label>
    <div className="form-actions"><small>저장 버튼을 눌러 기록해요.</small><button className="primary-button" disabled={!body.trim() || busy || !personal.ready || !profile}>{busy ? '저장 중…' : '메모 저장'}</button></div>
    {message && <p className="save-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<Link to="/notebook?tab=notes">저장한 메모 보기 →</Link>
  </form></details>;
}

export function NoteCard({ note }: { note: Note }) {
  const personal = usePersonal();
  const { curriculum } = useStudy();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body_markdown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const target = note.target;
  const page = target.kind === 'page' ? curriculum?.pages.find(p => p.id === target.id) : undefined;
  const concept = target.kind === 'concept' ? curriculum?.concepts.find(c => c.id === target.id) : undefined;
  const pageId = page?.id || concept?.page_ids[0];
  const questionRecord = target.kind === 'question' ? [
    ...personal.generatedQuestions, ...personal.attempts.map(a => a.question_snapshot), ...personal.bookmarks.map(b => b.question_snapshot), ...personal.selfAssessments.map(s => s.question_snapshot),
  ].find(q => q.id === target.id && q.revision === target.revision) : undefined;
  const title = page?.title || (target.kind === 'concept' ? target.id.replaceAll('-', ' ') : (target.id.startsWith('GQ-') ? 'AI 복습 문제' : target.id));
  const missing = target.kind === 'page' ? !page : target.kind === 'concept' ? !concept : false;
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try { await personal.note(target, body, note.id); setEditing(false); }
    catch { setError('수정 내용을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <article className="note-card"><div className="record-kicker"><span>{target.kind === 'concept' ? '개념 메모' : target.kind === 'page' ? '페이지 메모' : '문제 메모'}</span><time>{new Date(note.updated_at).toLocaleString('ko-KR')}</time></div><h3>{title}</h3>
    {questionRecord && <div className="prose note-question"><Prose>{questionRecord.prompt_markdown}</Prose></div>}
    {missing && <p className="small-notice">원래 자료를 찾지 못했어요. 메모는 보존되어 있어요.</p>}
    {page && target.kind === 'page' && target.revision !== page.revision && <p className="small-notice">이전 버전의 본문에 남긴 메모예요.</p>}
    {editing ? <><label className="sr-only" htmlFor={note.id}>메모 수정</label><textarea id={note.id} value={body} onChange={e => setBody(e.target.value)} rows={5} maxLength={20000} disabled={busy} /><div className="form-actions"><button disabled={busy} onClick={() => { setBody(note.body_markdown); setEditing(false); }}>취소</button><button className="primary-button" disabled={!body.trim() || busy} onClick={() => void save()}>{busy ? '저장 중…' : '수정 저장'}</button></div></> : <><div className="prose"><Prose>{note.body_markdown}</Prose></div><div className="form-actions">{pageId ? <Link to={`/learn/${pageId}`}>관련 본문 읽기 ↗</Link> : target.kind === 'question' && target.id.startsWith('CH') ? <Link to={`/quiz/${target.id.slice(0, 4)}`}>챕터 퀴즈 보기 ↗</Link> : target.kind === 'question' && questionRecord?.format === 'single_choice' && questionRecord.generation_id ? <Link to={`/review/ai?generation=${encodeURIComponent(questionRecord.generation_id)}`}>AI 복습 세트 보기 ↗</Link> : target.id.startsWith('CAP') ? <Link to="/quiz/capstones">종합 문제 보기 ↗</Link> : <span />}<button onClick={() => setEditing(true)}>메모 수정</button></div></>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </article>;
}
