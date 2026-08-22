import React, { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { getPlainMode, setPlainMode, PLAIN_CHANGE_EVENT } from '../utils/plainLanguage';
import { t } from '../i18n/strings';

// Header toggle for plain-language mode (issue #79). Self-contained: reads/
// writes the localStorage-backed preference itself and broadcasts a window
// event that every mounted <Jargon /> and the plainify() helper listen to.
export default function PlainLanguageToggle() {
  const [on, setOn] = useState(getPlainMode);

  useEffect(() => {
    const sync = () => setOn(getPlainMode());
    window.addEventListener(PLAIN_CHANGE_EVENT, sync);
    return () => window.removeEventListener(PLAIN_CHANGE_EVENT, sync);
  }, []);

  const tooltip = t('plainLanguage.toggleTooltip');

  return (
    <button
      onClick={() => setPlainMode(!on)}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={on}
      className="btn"
      style={on ? { borderColor: 'var(--decode-border)', color: 'var(--decode)', background: 'var(--decode-dim)' } : undefined}
    >
      <Languages size={15} />
      {t('plainLanguage.toggleLabel')}
    </button>
  );
}
