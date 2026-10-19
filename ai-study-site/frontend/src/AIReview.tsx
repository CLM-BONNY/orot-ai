import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStudy } from './study-state';
import { usePersonal } from './personal-state';
import { wrongAnswerGroups } from './practice-store';
import LearningHeader from './LearningHeader';
import type { Curriculum, ReviewResponse } from './types';

export default function AIReview() {
  const study = useStudy();
  const [params] = useSearchParams();
  if (study.contentError) return <><LearningHeader /><main className="practice-main"><p role="alert">{study.contentError}</p><button onClick={study.reload}>다시 불러오기</button></main></>;
  if (!study.curriculum) return <><LearningHeader /><main className="practice-main" role="status">복습할 개념을 불러오는 중이에요…</main></>;
  return <ReviewBuilder key={params.toString()} curriculum={study.curriculum} pageId={params.get('page')} initialConcepts={(params.get('concepts') || '').split(',').filter(Boolean)} />;
}

function ReviewBuilder({ curriculum, pageId, initialConcepts }: { curriculum: Curriculum; pageId: string | null; initialConcepts: string[] }) {
  const personal = usePersonal();
  const { profile } = useStudy();
  const navigate = useNavigate();
  const page = curriculum.pages.find(p => p.id === pageId);
  const [selected, setSelected] = useState<string[]>(() => [...new Set(initialConcepts.length ? initialConcepts : page?.concept_ids.slice(0,3) || [])].filter(id => curriculum.concepts.some(c => c.id === id)).slice(0,5));
  const [chapterId, setChapterId] = useState(page?.chapter_id || curriculum.chapters[0].id);
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('beginner');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('');
  const flight = useRef(false);
  const mounted = useRef(true);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const unsaved = useRef<{ response: ReviewResponse; ids: string[] } | null>(null);
  useEffect(() => { mounted.current = true; window.scrollTo({top:0,behavior:'instant'}); return () => { mounted.current = false; }; }, []);
  const pending = wrongAnswerGroups(personal.attempts).filter(g => !g.latest.is_correct);
  const wrongCounts = new Map<string,number>();
  pending.forEach(g => g.latest.question_snapshot.concept_ids.forEach(cid => { if (curriculum.concepts.some(c => c.id === cid)) wrongCounts.set(cid,(wrongCounts.get(cid)||0)+1); }));
  const suggestions = [...wrongCounts].sort((a,b) => b[1]-a[1]).slice(0,5).map(([id])=>id);
  const visible = curriculum.concepts.filter(c => search.trim() ? c.id.toLowerCase().includes(search.trim().toLowerCase().replaceAll(' ','-')) || c.page_ids.some(id => curriculum.pages.find(p => p.id === id)?.title.includes(search.trim())) : c.chapter_ids.includes(chapterId));
  function toggle(id: string) {
    setError('');
    setSelected(prev => prev.includes(id) ? prev.filter(c => c !== id) : prev.length < 5 ? [...prev,id] : prev);
  }
  async function generate() {
    if (flight.current || !selected.length || !profile) return;
    flight.current = true; setBusy(true); setError('');
    const ids = [...selected];
    try {
      let response = unsaved.current?.response;
      const savingIds = unsaved.current?.ids || ids;
      if (!response) {
        const sourceIds = page && ids.some(id => page.concept_ids.includes(id)) ? [page.id] : [];
        const input = { kind: 'review_request', content_release_id: curriculum.release_id, concept_ids: ids,
          source_page_ids: sourceIds, question_count: 3, difficulty };
        const signature = JSON.stringify(input);
        if (requestRef.current?.signature !== signature) requestRef.current = { signature, id: `REQ-${crypto.randomUUID()}` };
        setPhase('자료를 읽고 서로 다른 복습 문제 3개를 만들고 있어요.');
        const result = await fetch('/api/ai/review-quiz', { method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...input,request_id:requestRef.current!.id}) });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error?.message || '복습 문제를 만들지 못했어요.');
        response = data as ReviewResponse;
        if (response.content_release_id !== curriculum.release_id) throw new Error('학습 자료가 바뀌었어요. 새로고침해 주세요.');
        const allowedPages = new Set(curriculum.pages.map(p => p.id));
        if (response.questions.some(q => q.source_page_ids.some(pid => !allowedPages.has(pid)))) throw new Error('근거 페이지를 확인하지 못했어요.');
        unsaved.current = { response, ids };
      }
      setPhase('완성한 문제를 이 브라우저에 저장하고 있어요.');
      const generation = await personal.saveReview(response, savingIds);
      unsaved.current = null;
      if (mounted.current) navigate(`/review/ai?generation=${encodeURIComponent(generation.id)}`);
    } catch(e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '문제를 만들지 못했어요. 연결 상태를 확인해 주세요.');
    } finally { flight.current = false; if (mounted.current) { setBusy(false); setPhase(''); } }
  }
  const saved = [...personal.generations].sort((a,b)=>b.created_at.localeCompare(a.created_at));
  return <div className="ai-review-shell"><LearningHeader /><main className="ai-review-main"><Link className="back-link" to="/notebook">← 나의 학습</Link><div className="ai-review-intro"><span className="chapter-eyebrow">A NEW WAY TO REMEMBER</span><h1>같은 개념을,<br />새로운 질문으로.</h1><p>읽은 페이지나 아직 헷갈리는 개념을 골라보세요.<br />공부 도우미가 자료를 참고해 복습 문제 3개를 만들어요.</p></div>
    {personal.error && <div className="storage-warning" role="alert">{personal.error}<button onClick={personal.retry}>기록 다시 불러오기</button></div>}
    <section className="review-builder"><div className="builder-heading"><span className="step-bubble">01</span><div><h2>복습할 개념 고르기</h2><p>최대 5개까지 선택할 수 있어요.</p></div><span className="selection-count">{selected.length} / 5</span></div>
      {page && <p className="review-page-context">시작한 페이지 · <Link to={`/learn/${page.id}`}>{page.title} ↗</Link></p>}
      <div className="wrong-concept-suggestion"><div><strong>오답에서 시작해볼까요?</strong><p>{suggestions.length ? `아직 다시 풀 오답 ${pending.length}개에서 개념을 골라왔어요.` : '퀴즈에서 틀린 개념이 생기면 여기서 골라올 수 있어요.'}</p></div><button className="outline-button" disabled={busy || !!unsaved.current || !suggestions.length} onClick={()=>{setSelected(suggestions);setError('');}}>오답 개념 가져오기</button></div>
      <fieldset className="review-settings" disabled={busy || !!unsaved.current}><legend className="sr-only">개념과 난이도 설정</legend><div className="review-concept-controls"><label>챕터<select value={chapterId} onChange={e=>{setChapterId(e.target.value);setSearch('');}}>{curriculum.chapters.map(c=><option key={c.id} value={c.id}>{c.id} · {c.title}</option>)}</select></label><label>개념 검색<input type="search" placeholder="rag, attention, 본문 제목…" value={search} onChange={e=>setSearch(e.target.value)} /></label></div>
      <div className="concept-picker" aria-label="복습 개념 선택">{visible.map(c=><button key={c.id} aria-pressed={selected.includes(c.id)} className={selected.includes(c.id)?'selected':''} disabled={!selected.includes(c.id)&&selected.length>=5} onClick={()=>toggle(c.id)}>{selected.includes(c.id)?'✓ ':''}{c.id.replaceAll('-',' ')}</button>)}{!visible.length&&<p>일치하는 개념이 없어요. 다른 단어나 본문 제목으로 찾아보세요.</p>}</div>
      <div className="selected-concepts"><strong>선택한 개념</strong>{selected.length ? selected.map(cid=><button key={cid} onClick={()=>toggle(cid)} aria-label={`${cid} 선택 해제`}>{cid.replaceAll('-',' ')} <span>×</span></button>) : <p>위에서 복습할 개념을 선택해 주세요.</p>}</div>
      <div className="difficulty-control"><label>요청 난이도<select value={difficulty} onChange={e=>setDifficulty(e.target.value)}><option value="beginner">기초 · 용어와 핵심 구분</option><option value="intermediate">응용 · 상황에 적용</option><option value="advanced">심화 · 조건과 한계 판단</option></select></label><p>난이도는 생성 요청 기준이며, 검증된 난이도 등급은 아니에요.</p></div></fieldset>
      <div className="generate-actions"><p>선택한 개념과 관련 학습자료를 사용해요.<br />개인 메모와 전체 풀이 기록은 보내지 않아요.</p><button className="primary-button" disabled={busy||!selected.length||!personal.ready||!profile} onClick={()=>void generate()}>{busy?'문제 만드는 중…':unsaved.current?'완성한 문제 다시 저장':'AI 복습 3문제 만들기 →'}</button></div>
      {busy && <p className="generation-pending" role="status"><span className="thinking"><span/><span/><span/></span>{phase}<small>처음 실행할 때는 모델 준비에 시간이 더 걸릴 수 있어요.</small></p>}{error&&<p className="form-error generation-error" role="alert">{error}{unsaved.current&&' 완성된 결과를 유지했어요. 다시 저장하면 모델을 재호출하지 않아요.'}</p>}
      <p className="generated-note">AI가 만든 문제는 내용 검토 전 상태예요. 해설과 근거 본문을 함께 확인해 주세요.</p>
    </section>
    <section className="generated-history"><div className="builder-heading"><span className="step-bubble">02</span><div><h2>만들어 둔 복습 세트</h2><p>새로고침해도 이 브라우저에서 다시 풀 수 있어요.</p></div><span className="selection-count">{saved.length}개</span></div>{!personal.ready?<p role="status">저장된 문제를 불러오는 중이에요…</p>:!saved.length?<div className="empty-panel"><h3>첫 복습 세트를 만들어보세요.</h3><p>완성된 문제는 여기에 모여요.</p></div>:<div className="generated-set-list">{saved.map(g=><article className="generated-set" key={g.id}><div><span className="record-kicker">AI 생성 · 내용 검토 전 · {new Date(g.created_at).toLocaleString('ko-KR')}</span><h3>{g.concept_ids.map(id=>id.replaceAll('-',' ')).join(' · ')}</h3><p>{g.question_ids.length}문제 · {g.model}</p>{g.content_release_id!==curriculum.release_id&&<p className="small-notice">이전 학습자료로 만든 세트예요. 저장 당시 문제로 복습해요.</p>}</div><Link className="outline-button" to={`/review/ai?generation=${encodeURIComponent(g.id)}`}>문제 풀기 →</Link></article>)}</div>}</section>
  </main></div>;
}
