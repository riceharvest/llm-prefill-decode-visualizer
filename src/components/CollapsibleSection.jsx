import { useState } from 'react';
import { sectionAttributes, toggleAriaAttributes } from '../utils/collapsible.js';

/**
 * Collapsible panel used to tuck advanced/secondary controls behind a
 * one-line summary row. Default-collapsed keeps the page scannable;
 * open state persists for the session via sessionStorage.
 */
export default function CollapsibleSection({
  id,
  title,
  badge,
  defaultOpen = false,
  children,
}) {
  const storageKey = `llmpd-collapse-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === 'open' || defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStorage.setItem(storageKey, next ? 'open' : 'closed');
    } catch { /* ignore */ }
  };

  return (
    <section className="panel" {...sectionAttributes(id)}>
      <button
        type="button"
        className="collapse-head"
        onClick={toggle}
        {...toggleAriaAttributes(id, open)}
      >
        <span className="panel-title">{title}</span>
        {badge && <span className="tag">{badge}</span>}
        <span className="collapse-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id={`${id}-body`} className="collapse-body">
          {children}
        </div>
      )}
    </section>
  );
}
