import { Link, NavLink } from 'react-router-dom';
import { Icon } from './ui';
export default function LearningHeader() {
  return <header className="topbar"><Link className="brand" to="/"><span className="brand-icon"><Icon name="book" size={22} /></span><span>오롯<span className="brand-ai">AI</span></span></Link><span className="brand-divider" /><span className="brand-tagline">개념을 내 것으로.</span><nav className="top-actions" aria-label="학습 메뉴"><NavLink className="catalog-nav-link" to="/curriculum">전체 목차</NavLink><NavLink className="catalog-nav-link" to="/notebook">나의 학습</NavLink><Link className="helper-toggle active" to="/">이어 읽기 →</Link></nav></header>;
}
