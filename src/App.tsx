import { useState } from "react";

import { AboutPage } from "./About";
import { OpeningTrainingPage } from "./OpeningTraining";
import { ReviewGamePage } from "./ReviewGame";

// ---------------------------------------------------------------------------
// Pages & navigation
// ---------------------------------------------------------------------------

type Page = 'about' | 'training' | 'review';

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
    </nav>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('training');

  return (
    <div id="app">
      <NavBar current={page} onNavigate={setPage} />
      <main>
        <div id="canvas" className={page === 'training' ? 'training-layout' : ''}>
          {page === 'about' && <AboutPage />}
          {page === 'training' && <OpeningTrainingPage />}
          {page === 'review' && <ReviewGamePage />}
        </div>
      </main>
    </div>
  );
}
