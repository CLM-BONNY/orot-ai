import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStudy } from './study-state';
import { usePersonal } from './personal-state';
import { questionKey, wrongAnswerGroups } from './practice-store';
import LearningHeader from './LearningHeader';
import { NoteCard, NoteComposer } from './Notes';
import { Prose } from './ui';
import type { Question } from './types';

const BackupPanel = lazy(() => import('./BackupPanel'));

const tabs = { quizzes: '챕터 퀴즈', wrong: '오답노트', stars: '별표한 문제', notes: '개념 메모장', history: '풀이 이력' };
const questionLabel = (id: string) => id.startsWith('GQ-') ? 'AI 복습 문제' : id;
const date = (time: string) => new Date(time).toLocaleString('ko-KR');
const ratings = { again: '다시 공부할래요', partial: '일부 설명할 수 있어요', understood: '내 말로 설명할 수 있어요' };

export default function Notebook() {
  const { curriculum, contentError } = useStudy();
  const personal = usePersonal();
  const [params, setParams] = useSearchParams();
  const tab = Object.hasOwn(tabs, params.get('tab') || '') ? params.get('tab') as keyof typeof tabs : 'quizzes';
  const [query, setQuery] = useState('');
  const [wrongFilter, setWrongFilter] = useState('all');
  const [pendingStar, setPendingStar] = useState('');
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [tab]);
  const wrong = wrongAnswerGroups(personal.attempts);
  const pending = wrong.filter(g => !g.latest.is_correct);
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const matchingQuestion = (q: Question) => matches([q.id, q.prompt_markdown, ...q.concept_ids].join(' '));
  const notes = [...personal.notes].sort((a,b) => b.updated_at.localeCompare(a.updated_at)).filter(n => matches(`${n.target.id} ${n.body_markdown} ${curriculum?.pages.find(p => p.id === n.target.id)?.title || ''}`));
  const quizChapters = curriculum?.chapters.filter(c => matches([c.id, c.title, ...c.learning_objectives, ...curriculum.concepts.filter(concept => concept.chapter_ids.includes(c.id)).map(concept => concept.id)].join(' '))) || [];
  const bookmarks = [...personal.bookmarks].sort((a,b) => b.created_at.localeCompare(a.created_at)).filter(b => matchingQuestion(b.question_snapshot));
  const wrongVisible = wrong.filter(g => matchingQuestion(g.latest.question_snapshot) && (wrongFilter === 'all' || (wrongFilter === 'pending' ? !g.latest.is_correct : g.latest.is_correct)));
  const attempts = [...personal.attempts].sort((a,b) => b.submitted_at.localeCompare(a.submitted_at) || b.id.localeCompare(a.id)).filter(a => matchingQuestion(a.question_snapshot));
  const assessments = [...personal.selfAssessments].sort((a,b) => b.submitted_at.localeCompare(a.submitted_at)).filter(s => matchingQuestion(s.question_snapshot));
  async function unstar(q: Question) {
    if (pendingStar) return;
    setPendingStar(questionKey(q));
    try { await personal.star(q, false); } catch { /* provider exposes the actual error */ }
    finally { setPendingStar(''); }
  }
  return <div className="notebook-shell"><LearningHeader /><main className="notebook-main"><div className="notebook-intro"><div><span className="chapter-eyebrow">MY LEARNING SPACE</span><h1>읽은 것을,<br />내가 아는 것으로.</h1><p>틀린 순간도, 내 말로 적은 설명도 배움의 일부예요.</p></div><div className="notebook-flower" aria-hidden="true">✳</div></div>
    <div className="learning-stats"><div><span>다시 풀 오답</span><strong>{pending.length}<small>문제</small></strong></div><div><span>별표한 문제</span><strong>{personal.bookmarks.length}<small>문제</small></strong></div><div><span>남긴 메모</span><strong>{personal.notes.length}<small>개</small></strong></div><div><span>객관식 풀이 이력</span><strong>{personal.attempts.length}<small>회</small></strong></div></div>
    <Suspense fallback={<p>백업 도구를 불러오는 중이에요…</p>}><BackupPanel /></Suspense>
    <p className="local-record-notice">이 브라우저에 저장돼요. 읽기 완료·객관식 풀이·서술형 자기평가는 따로 기록해요.</p>
    {personal.error && <div className="storage-warning" role="alert">{personal.error}<button onClick={personal.retry}>기록 다시 불러오기</button></div>}
    {contentError && <p className="storage-warning" role="alert">{contentError}</p>}
    <Link className="ai-review-entry" to="/ai-review"><span><strong>AI 복습 퀴즈</strong><small>현재 개념이나 오답 개념으로 새로운 3문제를 만들어요.</small></span><span>{personal.generations.length ? `저장된 세트 ${personal.generations.length}개 · ` : ''}복습하러 가기 →</span></Link>
    <nav className="notebook-tabs" aria-label="나의 학습 분류">{Object.entries(tabs).map(([key,label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'selected' : ''} onClick={() => { setParams({ tab: key }); setQuery(''); }}>{label}{key === 'wrong' && pending.length>0 && <span>{pending.length}</span>}</button>)}</nav>
    {!personal.ready || (!curriculum && !contentError) ? <p role="status">학습 공간을 불러오는 중이에요…</p> : <>
      <div className="notebook-toolbar"><div><h2>{tabs[tab]}</h2><p>{tab === 'quizzes' ? '32개 챕터의 객관식·인출 연습과 종합 문제 6개' : tab === 'wrong' ? '한 번이라도 틀린 문제를 남겨두고, 가장 최근 풀이로 복습 상태를 판단해요.' : tab === 'stars' ? '다시 생각해보고 싶은 문제를 모아두었어요.' : tab === 'notes' ? '본문이나 문제의 메모 공간에서 기록을 추가할 수 있어요.' : '매번의 선택과 당시 해설을 보존해요. 서술형은 자기평가로 따로 보여요.'}</p></div><label><span className="sr-only">학습 기록 검색</span><input type="search" placeholder="제목·개념·기록 검색" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
      {tab === 'quizzes' && <>{!quizChapters.length && <Empty title="검색 결과가 없어요." text="다른 개념이나 챕터 이름으로 검색해보세요." />}<div className="quiz-chapter-grid">{quizChapters.map(c => {
        const count = personal.attempts.filter(a => a.question_snapshot.chapter_ids.includes(c.id)).length;
        const selfCount = personal.selfAssessments.filter(a => a.question_snapshot.chapter_ids.includes(c.id)).length;
        return <Link to={`/quiz/${c.id}`} className="quiz-chapter-card" key={c.id}><span className="record-kicker">{c.id}<span>객관식 2 · 설명 1</span></span><h3>{c.title}</h3><p>{count || selfCount ? `객관식 ${count}회 · 자기평가 ${selfCount}회 기록` : '아직 풀이 기록이 없어요'}</p><span className="card-arrow">풀어보기 ↗</span></Link>;
      })}</div>{!query && <Link className="capstone-link" to="/quiz/capstones"><span><strong>개념을 연결하는 종합 연습</strong><small>서술형 6개 · 설명 기준과 자기평가</small></span><span>도전하기 →</span></Link>}</>}
      {tab === 'wrong' && <><div className="record-filters">{[['all','전체 오답 이력'],['pending','다시 풀 대상'],['solved','다시 맞힌 문제']].map(([key,label]) => <button key={key} aria-pressed={wrongFilter === key} className={wrongFilter === key ? 'selected' : ''} onClick={() => setWrongFilter(key)}>{label}</button>)}<Link to={`/ai-review?concepts=${encodeURIComponent([...new Set(pending.flatMap(g => g.latest.question_snapshot.concept_ids))].slice(0,5).join(','))}`} className="outline-button">오답 개념으로 새 문제 만들기</Link><Link to="/review/wrong" className={`primary-button ${!pending.length ? 'disabled-link' : ''}`} aria-disabled={!pending.length} onClick={e => { if (!pending.length) e.preventDefault(); }}>오답 {pending.length}문제 다시 풀기 →</Link></div>
      {!wrongVisible.length ? <Empty title={query ? '검색 결과가 없어요.' : '이 분류의 오답 기록이 없어요.'} text="퀴즈에서 틀린 문제는 자동으로 여기에 모여요." /> : <div className="record-list">{wrongVisible.map(g => { const q = g.latest.question_snapshot; return <article className="saved-question" key={questionKey(q)}><div className="record-kicker"><span>{questionLabel(q.id)} · 저장 당시 문제</span><span className={`record-badge ${g.latest.is_correct ? 'solved' : ''}`}>{g.latest.is_correct ? '다시 맞혔어요' : '다시 풀어봐요'}</span></div><div className="prose question-preview"><Prose>{q.prompt_markdown}</Prose></div><p className="record-meta">총 {g.history.length}회 풀이 · 최근 {date(g.latest.submitted_at)}</p><details className="history-details"><summary>풀이 이력과 해설 보기</summary>{g.history.map(a => <div className="attempt-line" key={a.id}><strong>{a.is_correct ? '정답' : '오답'}</strong><span>{a.question_snapshot.options.find(o => o.id === a.selected_option_id)?.text}</span><time>{date(a.submitted_at)}</time></div>)}<div className="prose"><Prose>{q.explanation_markdown}</Prose></div></details><div className="record-links"><SourceLinks question={q} />{!g.latest.is_correct && <Link className="outline-button" to={`/review/wrong?question=${encodeURIComponent(questionKey(q))}`}>이 문제 다시 풀기 →</Link>}</div><NoteComposer target={{ kind: 'question', id: q.id, revision: q.revision }} concepts={q.concept_ids} /></article>; })}</div>}</>}
      {tab === 'stars' && <>{personal.bookmarks.length>0 && <div className="record-filters"><span>{personal.bookmarks.length}개 저장됨</span><Link className="primary-button" to="/review/star">별표한 문제 모두 풀기 →</Link></div>}{!bookmarks.length ? <Empty title={query ? '검색 결과가 없어요.' : '아직 별표한 문제가 없어요.'} text="문제의 별표 버튼으로 다시 볼 문제를 모아보세요." /> : <div className="record-list">{bookmarks.map(b => <article className="saved-question" key={b.id}><div className="record-kicker"><span>{questionLabel(b.question_ref.id)} · 저장 당시 문제</span><button className="star-button starred" disabled={!!pendingStar} onClick={() => void unstar(b.question_snapshot)}>★ 별표 해제</button></div><div className="prose question-preview"><Prose>{b.question_snapshot.prompt_markdown}</Prose></div><div className="concept-chips">{b.question_snapshot.concept_ids.map(c => <span key={c}>{c.replaceAll('-', ' ')}</span>)}</div><div className="record-links"><SourceLinks question={b.question_snapshot} /><Link className="outline-button" to={`/review/star?question=${encodeURIComponent(questionKey(b.question_snapshot))}`}>이 문제 풀기 →</Link></div></article>)}</div>}</>}
      {tab === 'notes' && (!notes.length ? <Empty title={query ? '검색 결과가 없어요.' : '첫 번째 이해를 남겨보세요.'} text="학습 페이지의 ‘개념 메모’에서 페이지·개념별 메모를 작성할 수 있어요." /> : <div className="notes-grid">{notes.map(n => <NoteCard key={n.id} note={n} />)}</div>)}
      {tab === 'history' && <><h3 className="history-section-title">객관식 풀이 <span>{attempts.length}회</span></h3>{!attempts.length ? <Empty title="객관식 풀이 기록이 없어요." text="정답을 확인할 때 선택한 답과 해설을 저장해요." /> : <div className="record-list">{attempts.map(a => <article className="saved-question compact" key={a.id}><div className="record-kicker"><span>{questionLabel(a.question_ref.id)} · {a.mode === 'wrong_retry' ? '오답 재풀이' : a.mode === 'starred' ? '별표 복습' : a.mode === 'ai_review' ? 'AI 복습' : '챕터 퀴즈'}</span><span className={`record-badge ${a.is_correct ? 'solved' : ''}`}>{a.is_correct ? '정답' : '오답'}</span></div><div className="prose question-preview"><Prose>{a.question_snapshot.prompt_markdown}</Prose></div><p className="record-meta">{date(a.submitted_at)} · {(a.elapsed_ms / 1000).toFixed(1)}초</p><details className="history-details"><summary>선택한 답과 해설</summary><p>내 선택: {a.question_snapshot.options.find(o => o.id === a.selected_option_id)?.text}</p><p>정답: {a.question_snapshot.options.find(o => o.id === a.question_snapshot.correct_option_id)?.text}</p><div className="prose"><Prose>{a.question_snapshot.explanation_markdown}</Prose></div><SourceLinks question={a.question_snapshot} /></details></article>)}</div>}
      <h3 className="history-section-title">설명하기 자기평가 <span>{assessments.length}회</span></h3>{!assessments.length ? <Empty title="자기평가 기록이 없어요." text="인출 연습이나 종합 문제에 내 설명을 남겨보세요." /> : <div className="record-list">{assessments.map(s => <article className="saved-question compact" key={s.id}><div className="record-kicker"><span>{s.question_ref.id} · 자기평가</span><span>{ratings[s.rating]}</span></div><div className="prose question-preview"><Prose>{s.question_snapshot.prompt_markdown}</Prose></div><p className="record-meta">{date(s.submitted_at)}</p><details className="history-details"><summary>내 설명과 설명 기준</summary><h4>내 설명</h4><div className="prose"><Prose>{s.response_markdown}</Prose></div><h4>설명 기준</h4><div className="prose"><Prose>{s.question_snapshot.expected_answer_markdown}</Prose></div><SourceLinks question={s.question_snapshot} /></details></article>)}</div>}</>}
    </>}
  </main></div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty-panel"><span>✳</span><h3>{title}</h3><p>{text}</p><Link to="/curriculum">학습 목차로 가기 →</Link></div>;
}
function SourceLinks({ question }: { question: Question }) {
  const { curriculum } = useStudy();
  return <div className="source-link-list">{question.source_page_ids.map(id => { const p = curriculum?.pages.find(page => page.id === id); return p ? <Link key={id} to={`/learn/${id}`}>{p.title} ↗</Link> : <span key={id}>{id} · 현재 자료에 없음</span>; })}</div>;
}
