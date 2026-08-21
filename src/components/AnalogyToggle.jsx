import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { getAnalogyMode, setAnalogyMode, ANALOGY_CHANGE_EVENT } from '../utils/analogies';
import { t } from '../i18n/strings';

// Header toggle for analogy mode (issue #84). Self-contained: reads/writes the
// localStorage-backed preference itself and broadcasts a window event that
// every mounted <Analogy /> chip listens to.
export default function AnalogyToggle() {
  const [on, setOn] = useState(getAnalogyMode);

  useEffect(() => {
    const sync = () => setOn(getAnalogyMode());
    window.addEventListener(ANALOGY_CHANGE_EVENT, sync);
    return () => window.removeEventListener(ANALOGY_CHANGE_EVENT, sync);
  }, []);

  const tooltip = t('analogies.toggleTooltip');

  return (
    <button
      onClick={() => setAnalogyMode(!on)}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={on}
      className="btn"
      style={on ? { borderColor: 'var(--decode-border)', color: 'var(--decode)', background: 'var(--decode-dim)' } : undefined}
    >
      <BookOpen size={15} />
      {t('analogies.toggleLabel')}
    </button>
  );
}
