import type { ReactNode } from 'react';
import { explainError, txUrl } from '@bullrun/sdk';
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

/** Reading, inside a panel. The same three chasing lamps the list screens and
 *  the canvas use, so waiting looks the same wherever it happens. */
export function Loading({ label = 'reading the chain' }: { label?: string }) {
  return (
    <div className="panel-loading">
      <i /><i /><i />
      <span>{label}</span>
    </div>
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

/**
 * A failure, said in a sentence, with viem's version kept out of the way.
 *
 * Takes the thrown value rather than a string, so no call site has to decide
 * what a wallet rejection looks like — every screen gets the same wording for
 * the same failure, and the raw text stays reachable for a bug report.
 */
export function Fault({ error }: { error: unknown }) {
  if (error === null || error === undefined || error === '') return null;
  const { title, detail, raw, benign } = explainError(error);
  return (
    <div className={`fault${benign ? ' fault--benign' : ''}`}>
      <p className="fault__title">{title}</p>
      {detail && <p className="fault__detail">{detail}</p>}
      {raw && raw !== title && (
        <details className="fault__more">
          <summary>technical detail</summary>
          <pre>{raw}</pre>
        </details>
      )}
    </div>
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
