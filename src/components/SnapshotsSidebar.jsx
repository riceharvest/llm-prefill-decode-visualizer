import React, { useState } from 'react';
import { Camera, Save, Trash2, Link2, RotateCcw, Check, Undo2, Redo2 } from 'lucide-react';
import { t } from '../i18n/strings';
import { loadSnapshots, saveSnapshots, parseSettings } from '../utils/settingsHistory';

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Short human summary of what a snapshot contains, e.g. "3800 / 105 tok/s".
function snapshotSummary(snap) {
  const s = parseSettings(snap.qs);
  const parts = [];
  if (s.preset) parts.push(s.preset);
  if (s.prefill !== null || s.decode !== null) {
    parts.push(`${s.prefill ?? '?'} / ${s.decode ?? '?'} ${t('common.tokPerSec')}`);
  }
  if (s.sim !== 1) parts.push(`${s.sim}x`);
  if (s.flags.length > 0) parts.push(s.flags.join('+'));
  return parts.join(' · ') || t('snapshots.emptySummary');
}

/**
 * Named settings snapshots sidebar (#96). Snapshots serialize to the shared
 * URL format (see utils/settingsHistory.js), so "copy link" hands out a
 * permalink that restores the configuration anywhere. Restoring is undoable —
 * App records it on the same history stack as manual edits.
 */
export default function SnapshotsSidebar({ currentQs, onRestore, canUndo, canRedo, onUndo, onRedo }) {
  const [snapshots, setSnapshots] = useState(loadSnapshots);
  const [name, setName] = useState('');
  const [copiedId, setCopiedId] = useState('');

  const persist = (list) => {
    setSnapshots(list);
    saveSnapshots(list);
  };

  const handleSave = () => {
    persist([{
      id: makeId(),
      name: name.trim() || t('snapshots.defaultName'),
      qs: currentQs,
      createdAt: Date.now()
    }, ...snapshots]);
    setName('');
  };

  const handleCopy = async (snap) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}?${snap.qs}`
      );
      setCopiedId(snap.id);
      setTimeout(() => setCopiedId(''), 2000);
    } catch {
      // clipboard may be unavailable; no-op
    }
  };

  return (
    <section className="panel" aria-label={t('snapshots.title')}>
      <div className="field-head" style={{ marginBottom: '10px' }}>
        <span className="panel-title">
          <Camera size={15} />
          {t('snapshots.title')}
        </span>
        {/* Global settings-history undo/redo (#96), parked next to snapshots */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title={t('history.undoTooltip')}
            aria-label={t('history.undoTooltip')}
            className="btn btn-icon"
          >
            <Undo2 size={15} />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title={t('history.redoTooltip')}
            aria-label={t('history.redoTooltip')}
            className="btn btn-icon"
          >
            <Redo2 size={15} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: snapshots.length > 0 ? '12px' : '4px' }}>
        <input
          type="text"
          value={name}
          placeholder={t('snapshots.namePlaceholder')}
          aria-label={t('snapshots.nameAria')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button onClick={handleSave} className="btn btn-icon" title={t('snapshots.save')} aria-label={t('snapshots.save')}>
          <Save size={16} />
        </button>
      </div>

      {snapshots.length === 0 ? (
        <p className="hint-text">{t('snapshots.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {snapshots.map((snap) => (
            <li key={snap.id} className="panel-inset" style={{ padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{snap.name}</div>
                  <div className="hint-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {snapshotSummary(snap)}
                  </div>
                </div>
                <button
                  onClick={() => onRestore(snap.qs)}
                  title={t('snapshots.restore')}
                  aria-label={`${t('snapshots.restore')}: ${snap.name}`}
                  className="btn btn-icon"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  onClick={() => handleCopy(snap)}
                  title={copiedId === snap.id ? t('common.copied') : t('snapshots.copyLink')}
                  aria-label={`${t('snapshots.copyLink')}: ${snap.name}`}
                  className="btn btn-icon"
                >
                  {copiedId === snap.id ? <Check size={15} /> : <Link2 size={15} />}
                </button>
                <button
                  onClick={() => persist(snapshots.filter(x => x.id !== snap.id))}
                  title={t('snapshots.delete')}
                  aria-label={`${t('snapshots.delete')}: ${snap.name}`}
                  className="btn btn-icon"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
