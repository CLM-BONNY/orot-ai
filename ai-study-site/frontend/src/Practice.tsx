import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useStudy } from './study-state';
import { usePersonal } from './personal-state';
import { questionKey, wrongAnswerGroups } from './practice-store';
import { Prose } from './ui';
import { NoteComposer } from './Notes';
import LearningHeader from './LearningHeader';
import type { Attempt, ChoiceQuestion, Question, SelfAssessment } from './types';

type Result = Attempt | SelfAssessment;
const ratings = { again: '다시 공부할래요', partial: '일부 설명할 수 있어요', understood: '내 말로 설명할 수 있어요' };
export default function Practice() {
  const { chapterId, mode } = useParams();
  const [params] = useSearchParams();
  return <PracticeRound key={`${chapterId || mode}:${params.get('question') || ''}:${params.get('generation') || ''}`} chapterId={chapterId} mode={mode} single={params.get('question')} generationId={params.get('generation')} />;
}

function PracticeRound({ chapterId, mode, single, generationId }: { chapterId?: string; mode?: string; single: string | null; generationId: string | null }) {
  const study = useStudy();
  const personal = usePersonal();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [finished, setFinished] = useState(false);
  const captured = useRef(false);
  const chapter = study.curriculum?.chapters.find(c => c.id === chapterId);
  const title = chapterId === 'capstones' ? '여러 개념을 연결하는 종합 연습' : chapter?.title || (mode === 'ai' ? 'AI가 만든 새로운 복습 퀴즈' : mode === 'wrong' ? '틀린 문제 다시 풀기' : '별표한 문제 풀기');
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [index, finished]);
  useEffect(() => {
    if (!chapterId) return;
    const controller = new AbortController();
    setError('');
    if (!/^CH\d{2}$/.test(chapterId) && chapterId !== 'capstones') { setError('없는 챕터예요.'); return; }
    fetch(chapterId === 'capstones' ? '/content/capstones.json' : `/content/quizzes/${chapterId}.json`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('문제를 불러오지 못했어요.'); return r.json(); })
      .then(data => setQuestions(chapterId === 'capstones' ? data : data.questions))
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [chapterId, epoch]);
  useEffect(() => {
    if (chapterId || !personal.ready || captured.current) return;
    if (personal.error) return;
    if (!['wrong', 'star', 'ai'].includes(mode || '')) { setError('없는 복습 방식이에요.'); return; }
    const generation = personal.generations.find(g => g.id === generationId);
    const queue = mode === 'ai' ? (generation?.question_ids.map(id => personal.generatedQuestions.find(q => q.id === id)).filter((q): q is ChoiceQuestion => !!q) || []) : mode === 'wrong'
      ? wrongAnswerGroups(personal.attempts).filter(g => !g.latest.is_correct).map(g => g.latest.question_snapshot)
      : personal.bookmarks.map(b => b.question_snapshot);
    setQuestions(single ? queue.filter(q => questionKey(q) === single) : queue);
    captured.current = true;
  }, [chapterId, mode, single, generationId, personal.ready, personal.error, personal.attempts, personal.bookmarks, personal.generations, personal.generatedQuestions]);
  const choiceResults = Object.values(results).filter((r): r is Attempt => 'is_correct' in r);
  const q = questions?.[index];
  const currentResult = q ? results[questionKey(q)] : undefined;
  const saveResult = (result: Result) => setResults(prev => ({ ...prev, [questionKey(result.question_ref)]: result }));
  return <div className="practice-shell"><LearningHeader /><main className="practice-main"><Link className="back-link" to={chapterId ? '/curriculum' : '/notebook'}>← {chapterId ? '전체 목차' : '나의 학습'}</Link><div className="practice-heading"><span className="chapter-eyebrow">RECALL & CONNECT</span><h1>{title}</h1><p>{mode === 'wrong' || mode === 'star' ? '저장 당시의 문제로 복습해요. 다시 푼 기록도 함께 남아요.' : '답을 먼저 떠올려보고, 해설로 빈틈을 채워보세요.'}</p></div>
    {mode === 'ai' && <p className="generated-note">AI가 만든 문제예요. 내용 검토 전 상태이며, 해설과 근거 본문을 함께 확인해 주세요. <Link to="/ai-review">저장된 복습 세트 보기 →</Link></p>}
    {personal.error && <div className="storage-warning" role="alert">{personal.error}<button onClick={personal.retry}>기록 다시 불러오기</button></div>}
    {error ? <div className="empty-panel" role="alert"><h2>{error}</h2><button onClick={() => setEpoch(e => e+1)}>다시 불러오기</button></div> : !personal.ready || !questions ? <p role="status">문제와 학습 기록을 불러오는 중이에요…</p> : !questions.length ? <div className="empty-panel"><span>✳</span><h2>{mode === 'ai' ? '저장된 AI 복습 세트를 찾지 못했어요.' : mode === 'wrong' ? '지금 다시 풀 오답이 없어요.' : '별표한 문제가 없어요.'}</h2><p>챕터 퀴즈를 풀면서 복습할 문제를 모아보세요.</p><Link className="primary-button" to={mode === 'ai' ? '/ai-review' : '/notebook?tab=quizzes'}>{mode === 'ai' ? '복습 세트 보기' : '챕터 퀴즈 보기'}</Link></div> : finished ? <section className="round-result"><span className="result-emblem">✓</span><h2>한 번 더 꺼내본 만큼,<br />이해가 단단해졌어요.</h2><p>이번 풀이 기록을 저장했어요.</p><div className="round-stats"><div><strong>{choiceResults.filter(a => a.is_correct).length}<small> / {choiceResults.length}</small></strong><span>객관식 정답</span></div><div><strong>{Object.values(results).filter(r => 'rating' in r).length}</strong><span>설명하기 자기평가</span></div></div><p className="muted">읽기 완료와 퀴즈 기록은 따로 관리해요.</p><div className="result-links"><Link className="primary-button" to="/notebook?tab=wrong">오답노트 확인 →</Link><Link to={chapter ? `/learn/${chapter.page_ids[0]}` : '/curriculum'}>본문으로 돌아가기</Link></div></section> : q && <>
      <div className="round-progress"><span>QUESTION {String(index+1).padStart(2, '0')}</span><span>{index+1} / {questions.length}</span></div><div className="progress-track"><span style={{ width: `${(index + (currentResult ? 1 : 0)) / questions.length * 100}%` }} /></div>
      <QuestionCard key={questionKey(q)} question={q} result={currentResult} onResult={saveResult} mode={mode === 'ai' ? 'ai_review' : mode === 'wrong' ? 'wrong_retry' : mode === 'star' ? 'starred' : 'chapter_quiz'} />
      <nav className="quiz-navigation" aria-label="퀴즈 페이지"><button disabled={index === 0} onClick={() => setIndex(i => i-1)}>← 이전 문제</button><span>{currentResult ? '저장된 풀이예요' : '풀이를 저장한 뒤 넘어가요'}</span><button className="primary-button" disabled={!currentResult} onClick={() => index === questions.length-1 ? setFinished(true) : setIndex(i => i+1)}>{index === questions.length-1 ? '학습 결과 보기' : '다음 문제 →'}</button></nav>
    </>}
  </main></div>;
}

function QuestionCard({ question: q, result, onResult, mode }: { question: Question; result?: Result; onResult: (r: Result) => void; mode: Attempt['mode'] }) {
  const personal = usePersonal();
  const { curriculum, profile } = useStudy();
  const [selected, setSelected] = useState('');
  const [response, setResponse] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starBusy, setStarBusy] = useState(false);
  const [error, setError] = useState('');
  // Authored explanations reference A–D, so preserve their displayed labels.
  const [order] = useState(() => q.format === 'single_choice' ? q.options.map(o => o.id) : []);
  const id = useRef(`ATT-${crypto.randomUUID()}`);
  const selfId = useRef(`SELF-${crypto.randomUUID()}`);
  const start = useRef(performance.now());
  const inFlight = useRef(false);
  const starred = personal.bookmarks.some(b => questionKey(b.question_ref) === questionKey(q));
  const attempt = result && 'is_correct' in result ? result : undefined;
  const assessment = result && 'rating' in result ? result : undefined;
  const displayOrder = attempt?.displayed_option_ids || order;
  async function submit() {
    if (q.format !== 'single_choice' || !selected || result || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { onResult(await personal.answer(q, selected, order, performance.now()-start.current, mode, id.current)); }
    catch { setError('풀이를 저장하지 못했어요. 선택한 답을 유지했으니 다시 눌러 주세요.'); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function assess(rating: SelfAssessment['rating']) {
    if (q.format !== 'self_explanation' || !response.trim() || result || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { onResult(await personal.reflect(q, response, rating, selfId.current)); }
    catch { setError('자기평가를 저장하지 못했어요. 적은 설명은 유지했어요.'); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function toggleStar() {
    if (starBusy) return;
    setStarBusy(true); setError('');
    try { await personal.star(q, !starred); } catch { setError('별표 변경을 저장하지 못했어요.'); }
    finally { setStarBusy(false); }
  }
  return <section className="question-card">{q.origin === 'generated' && <p className="generated-question-label">AI 생성 · 내용 검토 전</p>}<div className="question-top"><span>{q.category} · {q.format === 'single_choice' ? '객관식' : '내 말로 설명하기'}</span><button className={`star-button ${starred ? 'starred' : ''}`} onClick={() => void toggleStar()} aria-pressed={starred} disabled={starBusy || !personal.ready || !profile}>{starred ? '★ 별표 해제' : '☆ 별표하기'}</button></div><div className="question-prompt prose"><Prose>{q.prompt_markdown}</Prose></div><div className="concept-chips">{q.concept_ids.map(c => <span key={c}>{c.replaceAll('-', ' ')}</span>)}</div>
    {q.format === 'single_choice' ? <><fieldset className="quiz-options" disabled={!!result || busy}><legend className="sr-only">정답 하나를 선택하세요</legend>{displayOrder.map((oid, i) => { const option = (q as ChoiceQuestion).options.find(o => o.id === oid)!; const chosen = (attempt?.selected_option_id || selected) === oid; const correct = !!attempt && oid === q.correct_option_id; return <label key={oid} className={`quiz-option ${chosen ? 'chosen' : ''} ${correct ? 'correct' : ''} ${attempt && chosen && !attempt.is_correct ? 'incorrect' : ''}`}><input type="radio" name={q.id} value={oid} checked={chosen} onChange={() => setSelected(oid)} /><span className="option-letter">{String.fromCharCode(65+i)}</span><span>{option.text}</span>{correct && <small>정답</small>}{attempt && chosen && !attempt.is_correct && <small>내 선택</small>}</label>; })}</fieldset>
    {!attempt ? <button className="primary-button submit-answer" onClick={() => void submit()} disabled={!selected || busy || !profile}>{busy ? '저장 중…' : '정답 확인하고 저장'}</button> : <div className={`answer-feedback ${attempt.is_correct ? 'correct' : 'incorrect'}`} role="status"><strong>{attempt.is_correct ? '정답이에요. 잘 연결했어요.' : '이 부분을 다시 짚어봐요.'}</strong><div className="prose"><Prose>{q.explanation_markdown}</Prose></div><small>선택한 답과 해설을 풀이 이력에 저장했어요.</small></div>}</> : <div className="reflection-answer"><label htmlFor="self-response">자료를 보지 않고, 내 말로 설명해보세요.</label><textarea id="self-response" value={assessment?.response_markdown || response} onChange={e => setResponse(e.target.value)} rows={6} maxLength={20000} disabled={!!result || revealed || busy} placeholder="떠오르는 설명을 적어보세요. 완벽하지 않아도 괜찮아요." />{!revealed && !assessment && <button className="primary-button" disabled={!response.trim()} onClick={() => setRevealed(true)}>설명 기준과 비교하기</button>}{(revealed || assessment) && <div className="self-assessment"><strong>이런 내용을 연결해 설명하면 좋아요.</strong><div className="prose"><Prose>{q.expected_answer_markdown}</Prose></div>{assessment ? <p className="save-success" role="status">자기평가 저장됨 · {ratings[assessment.rating]}</p> : <><p>지금 어느 정도 설명할 수 있나요? 자동 채점하지 않아요.</p><div className="rating-buttons">{(Object.keys(ratings) as SelfAssessment['rating'][]).map(r => <button key={r} disabled={busy || !profile} onClick={() => void assess(r)}>{busy ? '저장 중…' : ratings[r]}</button>)}</div><button className="edit-reflection" disabled={busy} onClick={() => setRevealed(false)}>내 설명 수정하기</button></>}</div>}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <div className="quiz-sources"><strong>다시 읽어볼 페이지</strong>{q.source_page_ids.map(pid => { const page = curriculum?.pages.find(p => p.id === pid); return page ? <Link key={pid} to={`/learn/${pid}`}>{page.title} ↗</Link> : <span key={pid}>{pid} · 현재 자료에 없음</span>; })}</div>}
    <NoteComposer target={{ kind: 'question', id: q.id, revision: q.revision }} concepts={q.concept_ids} />
  </section>;
}
