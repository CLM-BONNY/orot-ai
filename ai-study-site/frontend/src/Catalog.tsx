import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudy } from './study-state';

export default function Catalog() {
  const study = useStudy();
  const [query, setQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState('all');
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  const { curriculum } = study;
  const term = query.trim().toLocaleLowerCase();
  const chapters = curriculum?.chapters.filter(c => {
    const pages = curriculum.pages.filter(p => p.chapter_id === c.id);
    const haystack = [c.title, ...c.learning_objectives, ...pages.flatMap(p => [p.title, ...p.concept_ids])].join(' ').toLocaleLowerCase();
    return (selectedTrack === 'all' || c.track_id === selectedTrack) && (!term || haystack.includes(term));
  }) || [];
  const resume = curriculum?.pages.find(p => p.id === study.resume?.page_ref.id);

  return <div className="catalog-shell">
    <header className="topbar"><Link className="brand" to="/"><span className="brand-icon">오</span><span>오롯<span className="brand-ai">AI</span></span></Link><span className="brand-divider" /><span className="brand-tagline">개념을 내 것으로.</span><nav className="top-actions"><Link className="catalog-nav-link" to="/notebook">나의 학습</Link><Link to="/" className="helper-toggle active">{resume ? '이어 읽기 →' : '학습 시작하기 →'}</Link></nav></header>
    <main className="catalog-main">
      <div className="catalog-intro"><span className="chapter-eyebrow">YOUR AI LEARNING LIBRARY</span><h1>지식의 조각들을,<br />하나의 이해로 연결해요.</h1><p>기초 수학부터 모델과 서비스까지.<br />읽고, 되짚고, 내 말로 설명하는 AI 학습 여정입니다.</p></div>
      {study.contentError ? <div className="storage-warning" role="alert">{study.contentError}<button onClick={study.reload}>다시 불러오기</button></div> : !curriculum ? <p role="status">목차를 불러오는 중이에요…</p> : <>
        <section className="catalog-status" aria-label="나의 읽기 진행"><div><span>나의 읽기 진행</span><strong>{study.completed.size}<small> / {curriculum.pages.length} 페이지</small></strong><div className="progress-track"><span style={{ width: `${study.completed.size / curriculum.pages.length * 100}%` }} /></div><p>읽기 완료 기록은 이 브라우저에 저장돼요.</p></div><div className="resume-card"><span>{resume ? '마지막으로 펼친 페이지' : '첫 페이지부터 시작해요'}</span><strong>{resume?.title || curriculum.pages[0].title}</strong><Link to="/">{resume ? '이어서 공부하기' : '학습 시작하기'} <span>↗</span></Link></div></section>
        {study.storageError && <p className="storage-warning" role="alert">{study.storageError}</p>}
        <div className="catalog-controls"><div><h2>전체 학습 목차</h2><p>8개 트랙 · 32개 챕터 · 96개 페이지</p></div><label className="catalog-search"><span className="sr-only">개념이나 챕터 검색</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="개념이나 챕터 검색" type="search" /></label></div>
        <div className="track-filters" aria-label="트랙 필터"><button className={selectedTrack === 'all' ? 'selected' : ''} onClick={() => setSelectedTrack('all')} aria-pressed={selectedTrack === 'all'}>전체</button>{curriculum.tracks.map(t => <button key={t.id} className={selectedTrack === t.id ? 'selected' : ''} aria-pressed={selectedTrack === t.id} onClick={() => setSelectedTrack(t.id)}>{t.id.slice(1)} {t.title}</button>)}</div>
        {(term || selectedTrack !== 'all') && <p className="search-count" role="status">{chapters.length}개 챕터{term && ` · “${query}” 검색 결과`}</p>}
        {chapters.length === 0 && <div className="empty-catalog"><h3>일치하는 목차가 없어요.</h3><p>다른 개념이나 제목으로 검색해보세요.</p><button onClick={() => { setQuery(''); setSelectedTrack('all'); }}>전체 목차 보기</button></div>}
        {curriculum.tracks.map(track => {
          const visible = chapters.filter(c => c.track_id === track.id);
          if (!visible.length) return null;
          return <section key={track.id} className="catalog-track"><div className="catalog-track-heading"><span>{track.id.slice(1)}</span><h2>{track.title}</h2><small>{visible.length}개 챕터</small></div><div className="catalog-chapters">{visible.map(chapter => {
            const complete = chapter.page_ids.filter(id => study.completed.has(id)).length;
            const firstUnread = chapter.page_ids.find(id => !study.completed.has(id)) || chapter.page_ids[0];
            return <article key={chapter.id} className={`catalog-chapter ${complete === chapter.page_ids.length ? 'all-read' : ''}`}><div className="catalog-chapter-top"><span>{chapter.id}</span><small>{complete === chapter.page_ids.length ? '읽기 완료' : `${complete}/${chapter.page_ids.length}쪽 완료`}</small></div><h3><Link to={`/learn/${firstUnread}`}>{chapter.title}</Link></h3><p>{chapter.learning_objectives[0]}</p><ol>{chapter.page_ids.map((id, i) => { const page = curriculum.pages.find(p => p.id === id)!; return <li key={id}><Link to={`/learn/${id}`}><span className={study.completed.has(id) ? 'is-read' : ''}>{study.completed.has(id) ? '✓' : String(i+1).padStart(2, '0')}</span>{page.title}</Link></li>; })}</ol></article>;
          })}</div></section>;
        })}
      </>}
      <footer className="catalog-footer">한 페이지씩, 오늘의 이해를 쌓아가요.</footer>
    </main>
  </div>;
}
