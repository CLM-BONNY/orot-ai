import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { StudyProvider, useStudy } from './study-state';
import { resumeFraction } from './reading-store';
import type { Page, PageRef } from './types';
import Catalog from './Catalog';
import { Icon, Prose } from './ui';
import { PersonalProvider } from './personal-state';
import { NoteComposer } from './Notes';
import Notebook from './Notebook';
import Practice from './Practice';
import AIReview from './AIReview';
import { usePersonal } from './personal-state';

type Meta = { model_ready: boolean; model: string; provider: string };
type Message = { role: 'user' | 'assistant'; text: string; sources?: string[]; answerStatus?: 'grounded' | 'insufficient_context'; pageRef?: PageRef; memoState?: 'saving' | 'saved' | 'error' };

function Reader() {
  const { pageId = 'CH01-P01' } = useParams();
  const navigate = useNavigate();
  const study = useStudy();
  const personal = usePersonal();
  const activePage = useRef(pageId);
  activePage.current = pageId;
  const memoFlights = useRef(new Set<string>());
  const { curriculum } = study;
  const [page, setPage] = useState<Page | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [chatErrors, setChatErrors] = useState<Record<string,string>>({});
  const chatError = chatErrors[pageId] || '';
  const failedQuestions = useRef<Record<string,string>>({});
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(window.innerWidth > 1180);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedTrack, setExpandedTrack] = useState('T01');
  const [selectedText, setSelectedText] = useState('');
  const [savingComplete, setSavingComplete] = useState(false);
  const [pageEpoch, setPageEpoch] = useState(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const savedPosition = useRef(study.resume);
  savedPosition.current = study.resume;
  const requestInFlight = useRef(false);
  const currentMessages = messages[pageId] || [];

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/meta', { signal: controller.signal }).then(r => r.json()).then(setMeta).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setError(''); setSelectedText(''); setQuestion(failedQuestions.current[pageId] || '');
    fetch(`/content/pages/${encodeURIComponent(pageId)}.json`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(r.status === 404 ? '없는 페이지예요.' : '페이지를 불러오지 못했어요.'); return r.json(); })
      .then(setPage).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [pageId, pageEpoch]);

  useEffect(() => {
    if (!page || page.id !== pageId || !study.ready) return;
    if (!study.profile) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const reference = { id: page.id, revision: page.revision };
    let cancelled = false;
    let listening = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fraction = resumeFraction(reference, savedPosition.current);
    const flush = () => { void study.savePosition(reference, fraction); };
    const onScroll = () => {
      const range = document.documentElement.scrollHeight - window.innerHeight;
      fraction = range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
      clearTimeout(timer);
      timer = setTimeout(flush, 180);
    };
    const onHide = () => { clearTimeout(timer); flush(); };
    void study.visit(reference);
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      const range = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: fraction * range, behavior: 'instant' });
      flush();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('pagehide', onHide);
      listening = true;
    })));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onHide);
      if (listening) flush();
    };
  }, [pageId, page?.id, page?.revision, study.ready, study.profile, study.visit, study.savePosition]);

  const chapter = curriculum?.chapters.find(c => c.id === page?.chapter_id);
  const track = curriculum?.tracks.find(t => t.id === chapter?.track_id);
  const position = (curriculum?.pages.findIndex(p => p.id === pageId) ?? -1) + 1;
  const total = curriculum?.pages.length || 96;
  const readComplete = study.completed.has(pageId);
  const chapterReadCount = chapter?.page_ids.filter(id => study.completed.has(id)).length || 0;
  const outdated = !!page && study.records.some(r => r.page_ref.id === page.id && r.page_ref.revision !== page.revision && r.state === 'completed');
  useEffect(() => { if (track) setExpandedTrack(track.id); }, [track?.id]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [currentMessages.length, pendingFor]);

  function go(id: string) { navigate(`/learn/${id}`); setSidebarOpen(false); }

  async function toggleComplete() {
    if (!page || savingComplete || !study.profile) return;
    setSavingComplete(true);
    try { await study.complete({ id: page.id, revision: page.revision }, !readComplete); }
    catch { /* StudyProvider displays the storage failure without claiming success. */ }
    finally { setSavingComplete(false); }
  }

  async function ask(text: string) {
    const value = text.trim();
    if (!value || !curriculum || !page || requestInFlight.current) return;
    requestInFlight.current = true;
    const targetPage = pageId;
    const history = (messages[targetPage] || []).slice(-4).map(m => ({ role: m.role, text: m.text.slice(0, 1000) }));
    setMessages(prev => ({ ...prev, [targetPage]: [...(prev[targetPage] || []), { role: 'user', text: value }] }));
    setQuestion(''); setChatErrors(prev=>({...prev,[targetPage]:''})); delete failedQuestions.current[targetPage]; setPendingFor(targetPage); setChatOpen(true);
    try {
      const response = await fetch('/api/ai/tutor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tutor_request', request_id: `REQ-${crypto.randomUUID()}`,
          content_release_id: curriculum.release_id, page_id: targetPage, message: value,
          selected_text: selectedText || null, history }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '답변을 받지 못했어요.');
      if (data.content_release_id !== curriculum.release_id || !data.answer_markdown?.trim() || !['grounded','insufficient_context'].includes(data.answer_status) || !Array.isArray(data.source_page_ids) || data.source_page_ids.some((id: string) => !curriculum.pages.some(p => p.id === id))) throw new Error('답변의 근거 정보를 확인하지 못했어요. 다시 질문해 주세요.');
      setMessages(prev => ({ ...prev, [targetPage]: [...(prev[targetPage] || []), {
        role: 'assistant', text: data.answer_markdown, sources: data.source_page_ids, answerStatus: data.answer_status, pageRef: { id: targetPage, revision: page.revision },
      }] }));
      setMeta(prev => prev ? { ...prev, model_ready: true } : prev);
    } catch (e) {
      setChatErrors(prev=>({...prev,[targetPage]:e instanceof Error ? e.message : '연결을 확인해 주세요.'}));
      failedQuestions.current[targetPage] = value;
      if (activePage.current === targetPage) setQuestion(value);
    } finally { setPendingFor(null); requestInFlight.current = false; }
  }

  async function saveAssistantNote(index: number, message: Message) {
    const ownerPage = pageId;
    const key = `${ownerPage}:${index}`;
    if (!message.pageRef || message.memoState === 'saved' || memoFlights.current.has(key)) return;
    memoFlights.current.add(key);
    const mark = (memoState: Message['memoState']) => setMessages(prev=>({...prev,[ownerPage]:(prev[ownerPage] || []).map((m,i)=>i === index ? {...m,memoState} : m)}));
    mark('saving');
    try { await personal.note({kind:'page', ...message.pageRef}, message.text); mark('saved'); }
    catch { mark('error'); }
    finally { memoFlights.current.delete(key); }
  }
  function captureSelection() {
    const selected = window.getSelection()?.toString().trim() || '';
    if (selected && selected.length <= 2000) setSelectedText(selected);
  }
  function submit(event: FormEvent) { event.preventDefault(); void ask(question); }

  return <div className={`shell ${chatOpen ? 'with-chat' : ''}`}>
    <header className="topbar">
      <Link className="brand" to="/"><span className="brand-icon"><Icon name="book" size={22} /></span><span>오롯<span className="brand-ai">AI</span></span></Link>
      <span className="brand-divider" /><span className="brand-tagline">개념을 내 것으로.</span>
      <nav className="top-actions" aria-label="화면 메뉴">
        <Link className="catalog-nav-link" to="/curriculum">전체 목차</Link><Link className="catalog-nav-link" to="/notebook">나의 학습</Link>
        <button className="text-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-expanded={sidebarOpen}><Icon name="list" />목차</button>
        <button className={`helper-toggle ${chatOpen ? 'active' : ''}`} onClick={() => setChatOpen(!chatOpen)} aria-expanded={chatOpen}><Icon name="sparkle" /> 공부 도우미</button>
      </nav>
    </header>

    {sidebarOpen && <button aria-label="목차 닫기" className="scrim" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="전체 학습 목차">
      <div className="sidebar-heading"><span>LEARNING PATH</span><span>8 TRACKS</span></div>
      <h2>AI Engineer의<br />기초를 단단하게.</h2>
      <p className="sidebar-description">수학에서 모델, 서비스까지<br />하나씩 연결하며 배워요.</p>
      <div className="study-progress" aria-label="전체 읽기 진행"><div><span>읽기 완료</span><strong>{study.completed.size} / {total}</strong></div><div className="progress-track"><span style={{ width: `${study.completed.size / total * 100}%` }} /></div><small>{study.storageError ? '저장 상태를 확인해 주세요' : '이 브라우저에 저장돼요'}</small></div>
      <div className="track-list">
        {curriculum?.tracks.map((t, i) => <section className={`track ${track?.id === t.id ? 'current' : ''}`} key={t.id}>
          <button className="track-button" onClick={() => setExpandedTrack(expandedTrack === t.id ? '' : t.id)} aria-expanded={expandedTrack === t.id}>
            <span className="track-number">{String(i + 1).padStart(2, '0')}</span><span>{t.title}</span><span className="chevron">{expandedTrack === t.id ? '−' : '+'}</span>
          </button>
          {expandedTrack === t.id && <div className="chapter-list">{t.chapter_ids.map(cid => {
            const c = curriculum.chapters.find(item => item.id === cid)!;
            const done = c.page_ids.filter(id => study.completed.has(id)).length;
            return <button key={cid} className={`chapter-link ${chapter?.id === cid ? 'selected' : ''}`} onClick={() => go(c.page_ids[0])} aria-current={chapter?.id === cid ? 'page' : undefined}><span className="chapter-dot" /><span className="chapter-name">{c.title}</span><span className="chapter-read-count">{done === c.page_ids.length ? <Icon name="check" size={12} /> : `${done}/${c.page_ids.length}`}</span></button>;
          })}</div>}
        </section>)}
      </div>
      <div className="sidebar-footer"><span className="leaf">✳</span><p>빠르게 훑기보다,<br /><strong>내 말로 설명할 수 있을 때까지.</strong></p></div>
    </aside>

    <main className="reader" id="reading-content">
      {(error || study.contentError) ? <div className="notice" role="alert"><h1>페이지를 열지 못했어요.</h1><p>{error || study.contentError}</p><button onClick={() => { study.reload(); setPageEpoch(e => e+1); }}>다시 불러오기</button><Link to="/curriculum">전체 목차로 이동</Link></div> : !page || !chapter ? <div className="loading-state" role="status">학습 자료를 펼치는 중이에요…</div> : <>
        <div className="breadcrumb"><span>{track?.title}</span><span>/</span><strong>{chapter.id}</strong></div>
        <div className="chapter-title-row"><span className="chapter-eyebrow">CHAPTER {chapter.id.slice(2)}</span><span className="page-counter">{chapter.page_ids.indexOf(pageId) + 1} / {chapter.page_ids.length} 페이지</span></div>
        <h1>{chapter.title}</h1>
        <p className="learning-goal">{chapter.learning_objectives[0]}</p>
        {chapter.prerequisite_chapter_ids.length > 0 && <div className="prerequisites"><span>먼저 알면 좋아요</span>{chapter.prerequisite_chapter_ids.map(id => { const previous = curriculum!.chapters.find(c => c.id === id); return previous ? <Link key={id} to={`/learn/${previous.page_ids[0]}`}>{previous.title}</Link> : null; })}</div>}
        {study.storageError && <p className="storage-warning" role="alert">{study.storageError}</p>}
        {outdated && !readComplete && <p className="content-change-notice">내용이 바뀐 페이지예요. 새 본문을 확인한 뒤 읽기 완료를 눌러 주세요.</p>}
        <div className="page-tabs" aria-label="이 챕터의 페이지">{chapter.page_ids.map((id, i) => <button key={id} onClick={() => go(id)} className={id === pageId ? 'selected' : ''} aria-current={id === pageId ? 'page' : undefined}><span>{study.completed.has(id) ? '✓' : String(i + 1).padStart(2, '0')}</span>{curriculum?.pages.find(p => p.id === id)?.title}</button>)}</div>
        <article onMouseUp={captureSelection} onTouchEnd={captureSelection} onKeyUp={captureSelection}>
          <div className="article-eyebrow">READ & UNDERSTAND</div><h2>{page.title}</h2>
          <div className="prose"><Prose>{page.body_markdown || ''}</Prose></div>
        </article>
        <details className="page-concepts"><summary>이 페이지의 개념 {page.concept_ids.length}개</summary><div>{page.concept_ids.map(id => <span key={id}>{id.replaceAll('-', ' ')}</span>)}</div></details>
        <div className={`completion-card ${readComplete ? 'is-complete' : ''}`}><div><strong>{readComplete ? '이 페이지를 읽었어요.' : '이 페이지의 내용을 읽었나요?'}</strong><p>이 챕터 {chapterReadCount}/{chapter.page_ids.length}쪽 읽기 완료 · 퀴즈 결과와 별도로 기록해요.</p></div><button onClick={() => void toggleComplete()} disabled={savingComplete || !study.profile} aria-pressed={readComplete}>{readComplete && <Icon name="check" size={16} />}{savingComplete ? '저장 중…' : readComplete ? '읽기 완료 취소' : '읽기 완료'}</button></div>
        <NoteComposer key={page.id} target={{ kind: 'page', id: page.id, revision: page.revision }} concepts={page.concept_ids} />
        <Link className="chapter-quiz-link" to={`/quiz/${chapter.id}`}><span><strong>읽었다면, 기억에서 꺼내볼까요?</strong><small>객관식 2문제 · 내 말로 설명하기 1문제</small></span><span>챕터 퀴즈 풀기 →</span></Link>
        <div className="reflection"><span className="reflection-icon"><Icon name="sparkle" size={22} /></span><div><strong>잠깐, 내 말로 정리해볼까요?</strong><p>방금 읽은 내용을 한 문장으로 설명해보세요.<br />막히는 부분은 공부 도우미와 함께 짚어볼 수 있어요.</p><button onClick={() => { setChatOpen(true); setQuestion('이 페이지의 핵심을 한 가지 쉬운 비유로 설명해줘.'); }}>도우미에게 물어보기 <Icon name="arrow" size={15} /></button></div></div>
        <footer className="reader-navigation"><button disabled={!page.previous_page_id} onClick={() => page.previous_page_id && go(page.previous_page_id)}><Icon name="back" /><span>이전 페이지</span></button><span className="global-position">{String(position).padStart(2, '0')} <span>/ {total}</span></span><button className="next-button" disabled={!page.next_page_id} onClick={() => page.next_page_id && go(page.next_page_id)}><span>다음 페이지</span><Icon name="arrow" /></button></footer>
        <div className="reading-position" aria-label={`전체 ${total}페이지 중 ${study.completed.size}페이지 읽기 완료`}><div style={{ width: `${study.completed.size / total * 100}%` }} /></div>
        {track && <details className="source-references"><summary>이 트랙의 참고 자료 {track.source_ids.length}개</summary><ul>{track.source_ids.map(id => { const source = curriculum!.sources.find(s => s.id === id); return source ? <li key={id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></li> : null; })}</ul></details>}
      </>}
    </main>

    {chatOpen && <aside className="chat-panel" aria-label="AI 공부 도우미">
      <div className="chat-heading"><span className="assistant-symbol"><Icon name="sparkle" size={20} /></span><div><h2>함께 이해해요</h2><p>지금 읽는 내용에서 시작해요.</p></div><button className="icon-button" aria-label="공부 도우미 닫기" onClick={() => setChatOpen(false)}><Icon name="close" /></button></div>
      <div className="chat-context"><Icon name="book" size={15} /><span>{page?.title || '학습 페이지'}</span></div>
      <div className="chat-messages" aria-live="polite">
        {!currentMessages.length && <div className="chat-welcome"><span className="welcome-kicker">YOUR LEARNING COMPANION</span><h3>헷갈려도 괜찮아요.</h3><p>어려운 용어는 다른 비유로,<br />추상적인 개념은 구체적인 예시로.<br />이해될 때까지 같이 살펴봐요.</p><div className="quick-questions">{['다른 비유로 설명해줘', '핵심을 짧게 정리해줘', '실제 서비스 예시를 들어줘', '이해했는지 확인할 질문을 하나 내줘'].map(text => <button disabled={!!pendingFor || !page} key={text} onClick={() => void ask(text)}>{text}<span>↗</span></button>)}</div></div>}
        {currentMessages.map((message, i) => <div className={`message ${message.role}`} key={i}><span className="message-label">{message.role === 'user' ? '나의 질문' : '공부 도우미'}</span><div className="prose"><Prose>{message.text}</Prose></div>{message.answerStatus === 'insufficient_context' && <p className="tutor-context-limit">현재 학습자료만으로 충분히 답하기 어려운 질문이에요.</p>}{!!message.sources?.length && <div className="tutor-source-links"><span>참고한 학습 페이지</span>{message.sources.map(id=><Link key={id} to={`/learn/${id}`}>{curriculum?.pages.find(p=>p.id===id)?.title || id} ↗</Link>)}</div>}{message.role === 'assistant' && message.pageRef && <button className="tutor-save-note" disabled={!personal.ready || !study.profile || message.memoState === 'saving' || message.memoState === 'saved'} onClick={()=>void saveAssistantNote(i,message)}>{message.memoState === 'saved' ? '✓ 메모에 저장했어요' : message.memoState === 'saving' ? '메모 저장 중…' : message.memoState === 'error' ? '저장 실패 · 다시 저장' : '이 설명을 메모로 남기기'}</button>}</div>)}
        {pendingFor === pageId && <div className="thinking" role="status"><span /><span /><span /><p>자료를 읽고 설명을 준비하고 있어요.</p></div>}
        {pendingFor && pendingFor !== pageId && <p className="small-notice">다른 페이지의 질문에 답하고 있어요.</p>}
        <div ref={chatEnd} />
      </div>
      <div className="chat-bottom">
        {chatError && <p className="chat-error" role="alert">{chatError}</p>}
        {selectedText && <div className="selection-preview"><span>선택한 문장: {selectedText.slice(0, 70)}{selectedText.length > 70 ? '…' : ''}</span><button aria-label="선택 문장 해제" onClick={() => setSelectedText('')}><Icon name="close" size={13} /></button></div>}
        <form onSubmit={submit}><label className="sr-only" htmlFor="question">공부 도우미에게 질문</label><textarea id="question" value={question} maxLength={3000} onChange={e => setQuestion(e.target.value)} placeholder="어떤 부분이 궁금한가요?" rows={3} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); } }} /><div className="composer-bottom"><span>Enter 전송 · Shift+Enter 줄바꿈</span><button type="submit" aria-label="질문 보내기" disabled={!question.trim() || !!pendingFor || !page}><Icon name="send" size={19} /></button></div></form>
        <Link className="tutor-review-link" to={`/ai-review?page=${encodeURIComponent(pageId)}`}>이 페이지로 AI 복습 퀴즈 만들기 →</Link>
        <div className="model-status"><span className={`status-dot ${meta?.model_ready ? 'ready' : ''}`} /><span>{meta?.model_ready ? `${meta.model.split(':')[0]} · ${meta.provider === 'ollama' ? '내 컴퓨터에서 실행' : '자체 추론 서버'}` : '모델 연결 상태를 확인해 주세요'}</span></div>
        <p className="ai-note">AI 설명은 틀릴 수 있어요. 학습자료와 함께 확인해요.</p>
      </div>
    </aside>}
  </div>;
}

export default function App() {
  return <StudyProvider><PersonalProvider><Routes><Route path="/" element={<ContinueReading />} /><Route path="/curriculum" element={<Catalog />} /><Route path="/learn/:pageId" element={<Reader />} /><Route path="/ai-review" element={<AIReview />} /><Route path="/notebook" element={<Notebook />} /><Route path="/quiz/:chapterId" element={<Practice />} /><Route path="/review/:mode" element={<Practice />} /><Route path="*" element={<Navigate to="/curriculum" replace />} /></Routes></PersonalProvider></StudyProvider>;
}

function ContinueReading() {
  const study = useStudy();
  if (study.contentError) return <div className="notice"><h1>학습 자료를 열지 못했어요.</h1><p>{study.contentError}</p><button onClick={study.reload}>다시 불러오기</button></div>;
  if (!study.ready || !study.curriculum) return <div className="loading-state">이어 읽을 페이지를 확인하고 있어요…</div>;
  const saved = study.curriculum.pages.find(p => p.id === study.resume?.page_ref.id);
  return <Navigate to={`/learn/${saved?.id || study.curriculum.pages[0].id}`} replace />;
}
