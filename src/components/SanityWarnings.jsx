import React from 'react';
import { TriangleAlert } from 'lucide-react';

// Non-blocking warning banner for physically implausible simulation inputs.
// `warnings` is the { code, message } array produced by sanityWarnings()
// in api/_math.js — the same checks the /api/compute responses carry.
// Renders nothing when the array is empty.
export default function SanityWarnings({ warnings }) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="sanity-warnings" role="status">
      <span className="sanity-warnings-title">
        <TriangleAlert size={14} aria-hidden="true" />
        Implausible input{warnings.length > 1 ? 's' : ''} detected
      </span>
      <ul>
        {warnings.map((w) => (
          <li key={w.code}>
            <code>{w.code}</code> — {w.message}
          </li>
        ))}
      </ul>
      <p className="sanity-warnings-note">
        Results below are shown as-is; fix the flagged input for a realistic simulation.
      </p>
    </div>
  );
}
