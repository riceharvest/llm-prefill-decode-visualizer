import React, { useEffect, useState } from 'react';
import { getPlainMode, PLAIN_CHANGE_EVENT } from '../utils/plainLanguage';
import { t } from '../i18n/strings';

/**
 * Progressive jargon disclosure (issue #79). Renders one dictionary term:
 *
 *  - plain-language mode OFF: the technical term as-is, with its full
 *    definition available on hover/focus (native tooltip).
 *  - plain-language mode ON: the plain equivalent inline; hover/focus still
 *    reveals the technical term plus its definition, so nothing is lost.
 *
 * Reacts to the header toggle via the shared window event. Optional children
 * override the displayed technical text (e.g. "TTFT (time to first token)")
 * while the plain swap and definition still come from the dictionary.
 *
 * props:
 *  - term: a key of plainLanguage.terms in strings.js (see PLAIN_TERMS)
 */
export default function Jargon({ term, children }) {
  const [plain, setPlain] = useState(getPlainMode);

  useEffect(() => {
    const sync = () => setPlain(getPlainMode());
    window.addEventListener(PLAIN_CHANGE_EVENT, sync);
    return () => window.removeEventListener(PLAIN_CHANGE_EVENT, sync);
  }, []);

  const short = children || t(`plainLanguage.terms.${term}.short`);
  const long = t(`plainLanguage.terms.${term}.long`);

  if (!plain) {
    return (
      <span className="jargon" title={long}>
        {short}
      </span>
    );
  }

  return (
    <abbr
      className="jargon jargon-plain"
      title={`${t('plainLanguage.glossaryTechnicalLabel')} ${short} — ${long}`}
    >
      {t(`plainLanguage.terms.${term}.plain`)}
    </abbr>
  );
}
