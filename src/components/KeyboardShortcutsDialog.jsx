import React, { useEffect, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useFocusTrap } from '../utils/focus';
import { t } from '../i18n/strings';

// Keyboard-shortcuts help dialog (issue #76): every global shortcut documented
// in one place, reachable with the `?` key or the header keyboard button.
// Modal per the WAI-ARIA dialog pattern — focus is trapped while open and
// restored to the opener on close (via useFocusTrap); Escape and a
// backdrop click both dismiss it.

// Shortcut rows: [keys, i18n key]. Groups keep the table scannable.
const GROUPS = [
  {
    title: () => t('shortcuts.groupSimulation'),
    items: [
      ['Space', 'shortcuts.playPause'],
      ['R', 'shortcuts.reset'],
      ['Ctrl+Z', 'shortcuts.undo'],
      ['Ctrl+Shift+Z', 'shortcuts.redo']
    ]
  },
  {
    title: () => t('shortcuts.groupNavigation'),
    items: [
      ['1 – 9', 'shortcuts.tabs'],
      ['?', 'shortcuts.help']
    ]
  },
  {
    title: () => t('shortcuts.groupControls'),
    items: [
      ['← → ↑ ↓', 'shortcuts.sliderArrows'],
      ['Home / End', 'shortcuts.sliderEnds']
    ]
  }
];

export default function KeyboardShortcutsDialog({ onClose }) {
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, true);

  // Escape closes. Capture phase so it wins over any other Escape handling.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-shortcuts-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-raised, var(--bg))',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius, 10px)',
          maxWidth: '440px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '20px 22px',
          outline: 'none',
          boxShadow: '0 12px 48px rgba(0,0,0,0.35)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <h2 id="kb-shortcuts-title" className="panel-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Keyboard size={16} />
            {t('shortcuts.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('shortcuts.close')}
            className="btn btn-icon"
          >
            <X size={15} />
          </button>
        </div>
        <p className="hint-text" style={{ marginTop: 0 }}>
          {t('shortcuts.subtitle')}
        </p>

        {GROUPS.map(group => (
          <div key={group.title()} style={{ marginBottom: '14px' }}>
            <h3 className="field-label" style={{ margin: '10px 0 6px' }}>{group.title()}</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {group.items.map(([keys, key]) => (
                  <tr key={keys}>
                    <td style={{ padding: '3px 8px 3px 0', whiteSpace: 'nowrap' }}>
                      <kbd>{keys}</kbd>
                    </td>
                    <td style={{ padding: '3px 0' }}>{t(key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
