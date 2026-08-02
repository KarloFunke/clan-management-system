'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * A section that folds down to one line.
 *
 * Used for the planning panels (fill order, transfers, roster allocation) once a season is signed
 * up: they are the whole screen while a roster is being formed, and dead weight above the live data
 * for the rest of the week. Collapsed rather than hidden — a leader still needs to reach the
 * re-allocate control and the transfer list, and the summary keeps the state visible without
 * scrolling past it.
 */
export default function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0',
          color: 'inherit', marginBottom: open ? 'var(--space-sm)' : 0,
        }}
      >
        {open ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
        <span style={{ fontSize: '1rem', fontWeight: 600 }}>{title}</span>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>{summary}</span>
      </button>
      {open && children}
    </div>
  );
}
