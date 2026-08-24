import React, { useState } from 'react';
import {
  GraduationCap,
  Play,
  CheckCircle2,
  XCircle,
  Lightbulb,
  ChevronRight,
  RotateCcw
} from 'lucide-react';
import { LESSONS, loadProgress, saveProgress, isComplete, checkAnswer, markAttempted, attemptCount } from '../utils/curriculum';
import { demoUrl } from '../utils/urlState';

// Curriculum mode (issue #89): a lesson rail of ordered lessons. Each lesson
// locks the simulator to a preset scenario, poses a prediction question, and
// lets the learner verify their answer against the live simulation — the
// prediction-then-verify teaching loop. Lesson backends are the existing sim
// tabs, opened via the same demoUrl deep-links TheoryGuide uses.

export default function CurriculumMode() {
  const [lessonIdx, setLessonIdx] = useState(0);
  const [choice, setChoice] = useState(null);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState(() => loadProgress());

  const lesson = LESSONS[lessonIdx];
  const isLast = lessonIdx === LESSONS.length - 1;
  const completedCount = LESSONS.filter(l => isComplete(progress, l.id)).length;
  // Wrong answers count as engagement too (#1022) — surfaced when it differs
  // from completed so "0 of 6 completed" can't hide six failed attempts.
  const attemptedTotal = LESSONS.reduce((n, l) => n + attemptCount(progress, l.id), 0);
  const isCorrect = checked && choice === lesson.correctIndex;

  const selectLesson = (idx) => {
    setLessonIdx(idx);
    setChoice(null);
    setChecked(false);
  };

  const handleCheck = () => {
    if (choice === null || checked) return;
    setChecked(true);
    // Canonical correctness check (#1022: checkAnswer() had zero UI consumers)
    // + every attempt recorded, wrong answers included.
    let next = markAttempted(progress, lesson.id);
    if (checkAnswer(lesson.id, choice)) {
      next = { ...next, completed: { ...next.completed, [lesson.id]: Date.now() } };
    }
    setProgress(saveProgress(next));
  };

  const optionStyle = (idx) => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    width: '100%',
    textAlign: 'start',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${
      checked && idx === lesson.correctIndex
        ? 'var(--decode)'
        : choice === idx
          ? 'var(--border-strong)'
          : 'var(--border)'
    }`,
    background: choice === idx ? 'var(--bg-inset)' : 'var(--bg-panel)',
    cursor: checked ? 'default' : 'pointer',
    fontSize: '0.82rem',
    color: 'var(--text-main)',
    lineHeight: 1.5
  });

  return (
    <div className="stack" aria-label="Curriculum mode">

      <section className="panel">
        <h2 className="panel-title" style={{ marginBottom: '4px' }} tabIndex={-1} data-panel-heading>
          <GraduationCap size={16} />
          <span>Curriculum</span>
        </h2>
        <p className="hint-text" style={{ marginBottom: '14px' }}>
          Six ordered lessons. Each one presets the simulator, asks you to predict the outcome,
          then lets you run it and check yourself. {completedCount} of {LESSONS.length} completed
          {attemptedTotal > completedCount ? ` · ${attemptedTotal} checked` : ''}.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: '14px', alignItems: 'start' }}>

          {/* Lesson rail */}
          <nav aria-label="Lesson list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {LESSONS.map((l, i) => {
              const done = isComplete(progress, l.id);
              const active = i === lessonIdx;
              return (
                <button
                  key={l.id}
                  onClick={() => selectLesson(i)}
                  aria-current={active ? 'step' : undefined}
                  className="btn"
                  style={{
                    justifyContent: 'flex-start',
                    alignItems: 'center',
                    display: 'flex',
                    gap: '8px',
                    padding: '8px 10px',
                    fontSize: '0.8rem',
                    borderColor: active ? 'var(--border-strong)' : 'var(--border)',
                    background: active ? 'var(--bg-inset)' : undefined,
                    color: 'var(--text-main)'
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      background: done ? 'var(--decode)' : 'var(--bg-inset)',
                      color: done ? '#0b0f14' : 'var(--text-muted)',
                      border: '1px solid var(--border-strong)'
                    }}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span>{l.title}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{l.tagline}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Lesson detail */}
          <div className="panel-inset">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Lesson {lessonIdx + 1}/{LESSONS.length}
              </span>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>{lesson.title}</h3>
            </div>

            {/* Locked preset scenario */}
            <div style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderInlineStart: '2px solid var(--prefill)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              marginBottom: '12px'
            }}>
              <div className="field-label" style={{ marginBottom: '4px' }}>Preset scenario</div>
              <p className="hint-text" style={{ marginBottom: '10px' }}>{lesson.setup}</p>
              <a
                href={demoUrl(lesson.demo)}
                className="btn"
                style={{ minHeight: '30px', padding: '5px 12px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Play size={12} />
                Run this scenario
              </a>
              <p className="hint-text" style={{ marginTop: '8px', fontSize: '0.7rem' }}>
                Opens the {lesson.backendTab === 'kvcache' ? 'KV Cache' : lesson.backendTab === 'agentic' ? 'Agentic Loop' : 'Single-Turn'} simulator preconfigured and autoplaying.
                {lesson.backendTab !== 'kvcache' ? ' Come back here to check your answer.' : ' Adjust it to test your prediction.'}
              </p>
            </div>

            {/* Prediction question */}
            <div className="field-label" style={{ marginBottom: '8px' }}>Predict: {lesson.question}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
              {lesson.options.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => { if (!checked) setChoice(idx); }}
                  style={optionStyle(idx)}
                  aria-pressed={choice === idx}
                  disabled={checked}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      border: '1px solid var(--border-strong)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      marginTop: '1px',
                      background: choice === idx ? 'var(--prefill)' : 'transparent',
                      color: choice === idx ? '#0b0f14' : 'var(--text-muted)'
                    }}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span>{opt}</span>
                  {checked && idx === lesson.correctIndex && (
                    <CheckCircle2 size={15} style={{ marginInlineStart: 'auto', flexShrink: 0, color: 'var(--decode)' }} />
                  )}
                </button>
              ))}
            </div>

            {/* Check / verdict */}
            {!checked ? (
              <button
                onClick={handleCheck}
                className="btn btn-accent"
                disabled={choice === null}
                style={{ opacity: choice === null ? 0.5 : 1, minHeight: '34px', padding: '6px 14px', fontSize: '0.8rem' }}
              >
                <CheckCircle2 size={15} />
                Check answer
              </button>
            ) : (
              <div style={{
                background: 'var(--bg-panel)',
                border: `1px solid ${isCorrect ? 'var(--decode)' : 'var(--prefill)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  {isCorrect
                    ? <CheckCircle2 size={16} style={{ color: 'var(--decode)', flexShrink: 0 }} />
                    : <XCircle size={16} style={{ color: 'var(--prefill)', flexShrink: 0 }} />}
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                    {isCorrect ? 'Correct — the simulation agrees.' : 'Not quite — run it and see.'}
                  </strong>
                </div>
                <p className="hint-text" style={{ marginBottom: '8px' }}>{lesson.explanation}</p>
                <p className="hint-text" style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <Lightbulb size={14} style={{ flexShrink: 0, color: 'var(--agent)' }} />
                  <span><strong style={{ color: 'var(--text-main)' }}>Verify it:</strong> {lesson.verify}</span>
                </p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                  {!isCorrect && (
                    <button
                      onClick={() => { setChecked(false); setChoice(null); }}
                      className="btn"
                      style={{ minHeight: '30px', padding: '5px 12px', fontSize: '0.76rem' }}
                    >
                      <RotateCcw size={12} />
                      Try again
                    </button>
                  )}
                  {!isLast && (
                    <button
                      onClick={() => selectLesson(lessonIdx + 1)}
                      className="btn btn-accent"
                      style={{ minHeight: '30px', padding: '5px 12px', fontSize: '0.76rem' }}
                    >
                      {isCorrect ? 'Next lesson' : 'Skip ahead'}
                      <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </section>

    </div>
  );
}
