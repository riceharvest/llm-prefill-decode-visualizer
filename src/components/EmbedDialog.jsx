import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Copy, Check, ImageDown } from 'lucide-react';
import { nodeToPngDataUri, exportNodeAsSvg } from '../utils/exportPng';
import { buildEmbedHtml, buildEmbedIframe, buildEmbedMarkdown } from '../utils/embedSnippet';
import { useFocusTrap } from '../utils/focus';
import { t } from '../i18n/strings';

// Embed dialog (#104): turns the current chart into copy-paste-ready
// snippets. The <img> and markdown variants carry the chart inline as a
// base64 PNG data-URI (self-contained, no hosting); the iframe variant
// points at the shared run URL (read-only, live). An SVG download is
// offered alongside for higher-fidelity reuse.
export default function EmbedDialog({ open, onClose, getNode, title, sourceUrl }) {
  const [dataUri, setDataUri] = useState('');
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const copyTimer = useRef(null);
  const dialogRef = useRef(null);

  // WAI-ARIA dialog pattern (#824): initial focus, Tab cycling inside the
  // dialog, and focus restored to the opener on close.
  useFocusTrap(dialogRef, open);

  // Escape closes the dialog (focus trap handles Tab only).
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const chartNode = open && getNode ? getNode() : null;

  // Generate the PNG data-URI once per open, off the live chart node.
  useEffect(() => {
    if (!open || !chartNode) return undefined;
    let cancelled = false;
    setError('');
    setDataUri('');
    nodeToPngDataUri(chartNode)
      .then((uri) => { if (!cancelled) setDataUri(uri); })
      .catch(() => { if (!cancelled) setError(t('embed.generateError')); });
    return () => { cancelled = true; };
  }, [open, chartNode]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = useCallback(async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(''), 2000);
    } catch { /* clipboard unavailable (insecure context / denied) — no-op */ }
  }, []);

  if (!open) return null;

  const size = chartNode ? chartNode.getBoundingClientRect() : null;
  const width = size ? Math.ceil(size.width) : 800;
  const height = size ? Math.ceil(size.height) : 450;

  const snippets = dataUri ? [
    {
      key: 'html',
      label: t('embed.htmlLabel'),
      hint: t('embed.htmlHint'),
      code: buildEmbedHtml({ dataUri, sourceUrl, width, height, alt: title || t('embed.defaultAlt') })
    },
    {
      key: 'markdown',
      label: t('embed.markdownLabel'),
      hint: t('embed.markdownHint'),
      code: buildEmbedMarkdown({ dataUri, sourceUrl, alt: title || t('embed.defaultAlt') })
    }
  ] : [];

  if (sourceUrl) {
    snippets.push({
      key: 'iframe',
      label: t('embed.iframeLabel'),
      hint: t('embed.iframeHint'),
      code: buildEmbedIframe({ sourceUrl, width, height, title: title || t('embed.defaultAlt') })
    });
  }

  const handleDownloadSvg = () => {
    const node = getNode ? getNode() : null;
    if (node) exportNodeAsSvg(node, 'chart.svg');
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(4, 6, 9, 0.72)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title || t('embed.dialogTitle')}
    >
      <div style={{
        background: 'var(--bg-panel)', border: '1px solid var(--border-strong)',
        borderRadius: '8px', width: 'min(680px, 100%)', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.5)'
      }}>
        <div className="field-head" style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: '8px'
        }}>
          <h3 className="panel-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ImageDown size={16} />
            <span>{title || t('embed.dialogTitle')}</span>
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
            <button
              onClick={handleDownloadSvg}
              className="btn"
              style={{ padding: '2px 8px', fontSize: '0.68rem' }}
              title={t('embed.downloadSvgTooltip')}
            >
              {t('embed.downloadSvg')}
            </button>
            <button
              onClick={onClose}
              className="btn"
              style={{ padding: '2px 6px', fontSize: '0.68rem' }}
              title={t('embed.close')}
              aria-label={t('embed.close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div style={{ padding: '14px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '0.76rem' }}>{error}</div>
          )}
          {!dataUri && !error && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{t('embed.generating')}</div>
          )}
          {snippets.map(({ key, label, hint, code }) => (
            <div key={key}>
              <div className="field-head" style={{ marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                <span className="section-label">{label}</span>
                <button
                  onClick={() => handleCopy(key, code)}
                  className="btn"
                  style={{
                    padding: '2px 8px', fontSize: '0.68rem', marginLeft: 'auto',
                    color: copiedKey === key ? 'var(--decode)' : undefined
                  }}
                  title={t('embed.copyTooltip')}
                >
                  {copiedKey === key ? (<><Check size={11} /> {t('common.copied')}</>) : (<><Copy size={11} /> {t('embed.copy')}</>)}
                </button>
              </div>
              <div style={{ color: 'var(--text-subtle)', fontSize: '0.68rem', marginBottom: '6px' }}>{hint}</div>
              <pre
                tabIndex={0}
                style={{
                  margin: 0, padding: '10px 12px', background: 'var(--bg-inset)',
                  border: '1px solid var(--border)', borderRadius: '6px',
                  fontFamily: 'var(--font-mono)', fontSize: '0.66rem', lineHeight: 1.5,
                  color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  maxHeight: '120px', overflowY: 'auto'
                }}
              >
                {code}
              </pre>
            </div>
          ))}
          <div style={{
            fontSize: '0.68rem', color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', paddingTop: '10px'
          }}>
            {t('embed.attributionNote')}
          </div>
        </div>
      </div>
    </div>
  );
}
