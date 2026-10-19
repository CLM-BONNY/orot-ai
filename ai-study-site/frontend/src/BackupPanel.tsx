import { useState } from 'react';
import { useStudy } from './study-state';
import { usePersonal } from './personal-state';
import { exportBackup, importBackup, validateBackup, type Backup } from './backup-store';

export default function BackupPanel() {
  const study = useStudy();
  const personal = usePersonal();
  const [pending,setPending] = useState<Backup | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const ready = study.profile && study.curriculum && personal.ready && !busy;
  async function download() {
    if (!study.profile || !study.curriculum) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const backup = await exportBackup(study.profile.id,study.curriculum.release_id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
      const a = document.createElement('a'); a.href=url; a.download=`orot-learning-${new Date().toISOString().slice(0,10)}.json`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000); setMessage('백업 파일을 다운로드했어요. 안전한 곳에 보관해 주세요.');
    } catch(e) { setError(e instanceof Error ? e.message : '백업하지 못했어요.'); }
    finally { setBusy(false); }
  }
  async function choose(file?: File) {
    setPending(null); setMessage(''); setError('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 20*1024*1024) throw new Error('20MB 이하의 JSON 백업 파일을 선택해 주세요.');
      setPending(await validateBackup(JSON.parse(await file.text())));
    } catch(e) { setError(e instanceof SyntaxError ? 'JSON 파일을 읽지 못했어요.' : e instanceof Error ? e.message : '파일을 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!pending || !study.profile) return;
    setBusy(true); setError('');
    try { await importBackup(pending,study.profile.id); window.location.reload(); }
    catch(e) { setError(e instanceof Error ? e.message : '가져오지 못했어요.'); setBusy(false); }
  }
  return <details className="backup-panel"><summary>학습 기록 백업·가져오기</summary><p>메모·풀이·별표·읽기 진행·AI 문제를 파일로 보관해요. 주소나 브라우저를 옮길 때 가져올 수 있어요. 파일은 서버에 전송하지 않아요.</p><div className="backup-actions"><button className="outline-button" disabled={!ready} onClick={()=>void download()}>JSON 백업 다운로드</button><label className={`outline-button ${!ready ? 'disabled-link' : ''}`}>백업 파일 선택<input type="file" accept=".json,application/json" disabled={!ready} onChange={e=>{ void choose(e.target.files?.[0]); e.target.value=''; }} /></label></div>
    {busy && <p role="status">기록을 확인하고 있어요…</p>}{error && <p className="storage-warning" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {pending && <div className="backup-preview"><strong>가져올 기록을 확인해 주세요.</strong><p>메모 {pending.notes.length}개 · 풀이 {pending.attempts.length}회 · 별표 {pending.bookmarks.length}개 · 읽기 {pending.reading_progress.length}쪽 · AI 세트 {pending.generations.length}개 · 자기평가 {pending.self_assessments.length}회</p>{pending.content_release_id !== study.curriculum?.release_id && <p>이전 학습자료의 기록이에요. 당시 문제와 개정 버전을 유지해요.</p>}<p>기존 기록을 유지하며 추가해요. 읽기와 이어 읽기는 더 최근 기록을 사용해요. 같은 ID의 내용이 다르면 전체 가져오기를 취소해요. 완료되면 화면을 새로고침해요.</p><div className="backup-actions"><button className="primary-button" disabled={!ready} onClick={()=>void restore()}>확인한 기록 가져오기</button><button disabled={busy} onClick={()=>setPending(null)}>취소</button></div></div>}
  </details>;
}
