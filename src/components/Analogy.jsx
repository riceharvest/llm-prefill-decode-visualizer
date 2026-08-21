import React, { useEffect, useState } from 'react';
import { ANALOGY_TERMS, getAnalogyMode, ANALOGY_CHANGE_EVENT } from '../utils/analogies';
import { t } from '../i18n/strings';

/**
 * Inline everyday-analogy chip (issue #84). Renders nothing unless analogy
 * mode is enabled; when enabled it shows the plain-language analogy next to
 * the technical term, e.g. "Prefill Speed = reading the whole book before
 * answering". Reacts to the header toggle via the shared window event.
 *
 * props:
 *  - term: one of ANALOGY_TERMS ('prefill' | 'decode' | 'prefixCaching' | 'kvCache')
 */
export default function Analogy({ term }) {
  const [on, setOn] = useState(getAnalogyMode);

  useEffect(() => {
    const sync = () => setOn(getAnalogyMode());
    window.addEventListener(ANALOGY_CHANGE_EVENT, sync);
    return () => window.removeEventListener(ANALOGY_CHANGE_EVENT, sync);
  }, []);

  if (!on || !ANALOGY_TERMS.includes(term)) return null;

  return (
    <span className="analogy-chip" data-analogy={term}>
      = {t(`analogies.items.${term}`)}
    </span>
  );
}
