import React, { useState } from 'react';
import { Brain, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import {
  checksForTab,
  getProgress,
  recordAnswer,
  resetProgress
} from '../utils/conceptChecks';

// Concept-check quiz panel (prediction-then-reveal). Rendered at the bottom of
// each tab that has live simulation state; every quiz's reveal text is
// recomputed from that tab's CURRENT values, so explanations always quote the
// numbers the user is actually looking at. Per-tab outcomes persist in
// localStorage (`{checkId: wasCorrect}`); an already-answered check shows its
// result but can be retried, which updates the stored outcome. The exact
// picked option is session-only state — after a reload only correct/incorrect
// status is restored.

export default function ConceptCheck({ tab, context }) {
  const checks = checksForTab(tab);
  // checkId -> wasCorrect, hydrated from localStorage.
  const [answers, setAnswers] = useState(() => getProgress()[tab] || {});
  // checkId -> picked choice index (this visit only).
  const [picks, setPicks] = useState({});

  if (checks.length === 0) return null;

  const summary = checks.reduce(
    (acc, check) => {
      if (answers[check.id] !== undefined) {
        acc.answered += 1;
        if (answers[check.id]) acc.correct += 1;
      }
      return acc;
    },
    { answered: 0, correct: 0 }
  );

  const handleAnswer = (check, index) => {
    const wasCorrect = Boolean(check.choices[index].correct);
    setPicks(prev => ({ ...prev, [check.id]: index }));
    setAnswers(prev => ({ ...prev, [check.id]: wasCorrect }));
    recordAnswer(tab, check.id, wasCorrect);
  };

  const handleReset = () => {
    resetProgress();
    setAnswers({});
    setPicks({});
  };

  return (
    <section className="panel" aria-label="Concept-check quizzes">
      <h2 className="panel-title" style={{ marginBottom: '4px' }}>
        <Brain size={16} />
        <span>Concept checks</span>
        <span className="concept-progress" aria-label={`${summary.correct} of ${checks.length} correct`}>
          {summary.correct}/{checks.length} correct
        </span>
        <button
          type="button"
          className="btn btn-icon concept-reset"
          onClick={handleReset}
          aria-label="Reset concept-check progress"
          title="Reset progress"
        >
          <RotateCcw size={13} />
        </button>
      </h2>
      <p className="hint-text" style={{ marginBottom: '12px' }}>
        Predict first, then check yourself against the live simulation — every explanation quotes the numbers currently on screen.
      </p>

      <div className="grid-auto" style={{ '--grid-min': '20rem' }}>
        {checks.map((check, ci) => {
          const wasCorrect = answers[check.id];
          const isAnswered = wasCorrect !== undefined;
          const pickIndex = picks[check.id];
          return (
            <div
              key={check.id}
              className={`panel-inset concept-check${isAnswered ? (wasCorrect ? ' is-correct-card' : ' is-wrong-card') : ''}`}
              aria-label={`Concept check ${ci + 1} of ${checks.length}`}
            >
              <div className="concept-question">
                <span className="concept-q-badge" aria-hidden="true">Q{ci + 1}</span>
                <span style={{ flex: 1 }}>{check.question}</span>
                {isAnswered && (wasCorrect
                  ? <CheckCircle2 size={16} style={{ color: 'var(--decode)', flexShrink: 0 }} aria-label="Correct" />
                  : <XCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} aria-label="Incorrect" />)}
              </div>

              <div className="concept-choices" role="group" aria-label="Answer choices">
                {check.choices.map((choice, i) => {
                  let cls = 'concept-choice';
                  if (isAnswered && choice.correct) cls += ' is-correct';
                  else if (isAnswered && pickIndex === i) cls += ' is-wrong';
                  return (
                    <button
                      key={i}
                      type="button"
                      className={cls}
                      onClick={() => handleAnswer(check, i)}
                      disabled={isAnswered}
                      aria-pressed={pickIndex === i}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>

              {isAnswered && (
                <div className={`concept-reveal ${wasCorrect ? 'good' : 'bad'}`} role="status">
                  <strong>{wasCorrect ? 'Correct — ' : 'Not quite — '}</strong>
                  {check.reveal(context)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
