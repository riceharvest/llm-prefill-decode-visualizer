import React, { useEffect, useRef, useState } from 'react';
import { Camera, Save, Trash2, Link2, RotateCcw, Check, Undo2, Redo2, Download, Upload } from 'lucide-react';
import { t } from '../i18n/strings';
import {
  loadSnapshots, saveSnapshots, parseSettings,
  exportSnapshots, importSnapshots, mergeSnapshots, onExternalSnapshots
} from '../utils/settingsHistory';
import { buildShareLink } from '../utils/permalink';
import { copyTextToClipboard } from '../utils/clipboard';
import { sanitizeBudgets } from '../utils/slo';

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
 * permalink that restores the configuration anywhere. The link is minted by
 * the canonical builder (#875) with `tab` pinned to the active view, so it
 * reopens exactly what was saved instead of an accidental default view.
 * Restoring is undoable — App records it on the same history stack as manual
 * edits.
 *
 * Snapshots also carry the SLO budgets active at save time (#613) and stay in
 * sync across tabs via storage events (#610).
 */
export default function SnapshotsSidebar({ currentQs, activeTab, budgets, onRestore, restoreReport, canUndo, canRedo, onUndo, onRedo }) {
  const [snapshots, setSnapshots] = useState(loadSnapshots);
  const [name, setName] = useState('');
  const [copiedId, setCopiedId] = useState('');
  // #566: storage failures used to be swallowed — surface them instead.
  const [saveFailed, setSaveFailed] = useState(false);
  const [importNote, setImportNote] = useState(null);
  const fileInputRef = useRef(null);

  // #610: another tab's save/delete updates this tab instead of being
  // overwritten by the next write here (last-writer-wins erasure).
  useEffect(() => onExternalSnapshots((fresh) => setSnapshots(fresh)), []);

  const persist = (list) => {
    setSnapshots(list);
    const ok = saveSnapshots(list);
    setSaveFailed(!ok);
  };

  const handleExport = () => {
    try {
      const blob = new Blob([exportSnapshots(snapshots)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshots-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setImportNote({ ok: false, reason: t('snapshots.exportFailed') });
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch {
      setImportNote({ ok: false, reason: t('snapshots.importUnreadable') });
      return;
    }
    const res = importSnapshots(text);
    if (res.error || res.snapshots.length === 0) {
      setImportNote({
        ok: false,
        reason: res.error
          ? t('snapshots.importInvalid', { reason: res.error })
          : t('snapshots.importEmpty', { skipped: res.skipped })
      });
      return;
    }
    persist(mergeSnapshots(snapshots, res.snapshots));
    setImportNote({ ok: true, count: res.snapshots.length, skipped: res.skipped });
  };

  // #427: download the whole snapshot set as a versioned JSON document.
  const handleExport = () => {
    downloadJson(buildSnapshotExport(snapshots), 'llmpdv-snapshots.json');
  };

  // #427: merge an exported document back in; colliding ids get fresh ids so
  // nothing already stored is overwritten, invalid files are flagged inline.
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const parsed = parseSnapshotImport(text, snapshots.map(s => s.id));
      if (!parsed || parsed.snapshots.length === 0) {
        setImportInvalid(true);
        setTimeout(() => setImportInvalid(false), 3000);
        return;
      }
      persist([...parsed.snapshots, ...snapshots]);
    }).catch(() => {
      setImportInvalid(true);
      setTimeout(() => setImportInvalid(false), 3000);
    });
  };

  const handleSave = () => {
    persist([{
      id: makeId(),
      name: name.trim() || t('snapshots.defaultName'),
      qs: currentQs,
      budgets: sanitizeBudgets(budgets), // #613: restore re-judges with THESE budgets
      createdAt: Date.now()
    }, ...snapshots]);
    setName('');
  };

  const handleCopy = async (snap) => {
    // Shared helper (#1034): execCommand fallback for blocked-clipboard
    // contexts; only flash "copied" on a successful copy.
    if (await copyTextToClipboard(
      buildShareLink({
        origin: window.location.origin,
        pathname: window.location.pathname,
        search: snap.qs ? `?${snap.qs}` : '',
        tab: activeTab
      })
    )) {
      setCopiedId(snap.id);
      setTimeout(() => setCopiedId(''), 2000);
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
        <button onClick={handleExport} disabled={snapshots.length === 0} className="btn btn-icon" title={t('snapshots.export')} aria-label={t('snapshots.export')}>
          <Download size={15} />
        </button>
        <button onClick={() => fileInputRef.current?.click()} className="btn btn-icon" title={t('snapshots.import')} aria-label={t('snapshots.import')}>
          <Upload size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      {/* #566: storage write failures are visible instead of silently losing saves */}
      {saveFailed && (
        <p className="hint-text" role="alert" style={{ color: 'var(--text-warn, #fbbf24)', margin: '0 0 8px' }}>
          {t('snapshots.saveFailed')}
        </p>
      )}
      {importNote && (
        <p className="hint-text" role={importNote.ok ? 'status' : 'alert'} style={{ margin: '0 0 8px' }}>
          {importNote.ok
            ? t('snapshots.imported', { count: importNote.count, skipped: importNote.skipped })
            : importNote.reason}
        </p>
      )}
      {/* #569: partial-restore adjustments are visible instead of silent */}
      {restoreReport && (restoreReport.unresolvedPreset || restoreReport.resetToDefaults.length > 0) && (
        <p className="hint-text" role="status" style={{ margin: '0 0 8px' }}>
          {[
            restoreReport.unresolvedPreset
              ? t('snapshots.restoreUnresolvedPreset', { preset: restoreReport.unresolvedPreset })
              : null,
            restoreReport.resetToDefaults.length > 0
              ? t('snapshots.restoreReset', { fields: restoreReport.resetToDefaults.join(', ') })
              : null
          ].filter(Boolean).join(' ')}
        </p>
      )}

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
                  onClick={() => onRestore(snap.qs, snap.budgets)}
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
