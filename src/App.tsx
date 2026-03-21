import { useState } from "react";

import { AboutPage } from "./About";
import { OpeningTrainingPage } from "./OpeningTraining";
import { ReviewGamePage } from "./ReviewGame";
import { ReviewMistakesPage } from "./ReviewMistakes";
import { EvalBattlePage } from "./EvalBattle";

// ---------------------------------------------------------------------------
// Pages & navigation
// ---------------------------------------------------------------------------

type Page = 'about' | 'training' | 'review' | 'mistakes' | 'eval-battle';

type NavBarProps = {
  current: Page;
  onNavigate: (page: Page) => void;
};

function NavBar({ current, onNavigate }: NavBarProps) {
  return (
    <nav id="navbar">
      <button
        className={current === 'about' ? 'active' : ''}
        onClick={() => onNavigate('about')}
      >
        About
      </button>
      <button
        className={current === 'training' ? 'active' : ''}
        onClick={() => onNavigate('training')}
      >
        Opening training
      </button>
      <button
        className={current === 'review' ? 'active' : ''}
        onClick={() => onNavigate('review')}
      >
        Review game
      </button>
      <button
        className={current === 'mistakes' ? 'active' : ''}
        onClick={() => onNavigate('mistakes')}
      >
        Review mistakes
      </button>
      <button
        className={current === 'eval-battle' ? 'active' : ''}
        onClick={() => onNavigate('eval-battle')}
      >
        Eval battle
      </button>
    </nav>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('about');

  return (
    <div id="app">
      <NavBar current={page} onNavigate={setPage} />
      <main>
        <div id="canvas" className={page === 'training' || page === 'mistakes' || page === 'eval-battle' ? 'training-layout' : page === 'review' ? 'review-layout' : ''}>
          {page === 'about' && <AboutPage />}
          {page === 'training' && <OpeningTrainingPage />}
          {page === 'review' && <ReviewGamePage />}
          {page === 'mistakes' && <ReviewMistakesPage />}
          {page === 'eval-battle' && <EvalBattlePage />}
        </div>
      </main>
    </div>
  );
}
