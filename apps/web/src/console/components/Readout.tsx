import type { ReactNode } from 'react';
import { txUrl } from '@bullrun/sdk';
import { useSdk } from '../../sdk';

/** A panel cut into the plate — the console's only way of showing text.
 *  Same construction as the CRT housing, so a duel screen and the game read as
 *  parts of one machine rather than two front ends. */
export function Readout({
  title, right, children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="readout-panel">
      <div className="readout-panel__title">
        <b>{title}</b>
        {right ? <span>{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="rows">{children}</dl>;
}

export function Row({ label, tone, children }: { label: string; tone?: 'up' | 'dn' | 'lamp'; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={tone}>{children}</dd>
    </>
  );
}

/** Addresses are long and nobody reads the middle. */
export function Addr({ value }: { value: string }) {
  return <span className="addr">{value.slice(0, 10)}…{value.slice(-8)}</span>;
}

export function TxLine({ hash, label = 'confirmed' }: { hash: string; label?: string }) {
  const { cfg } = useSdk();
  return (
    <p className="txline ok">
      {label} · <a href={txUrl(cfg, hash)} target="_blank" rel="noreferrer">
        {hash.slice(0, 10)}…{hash.slice(-8)}
      </a>
    </p>
  );
}
