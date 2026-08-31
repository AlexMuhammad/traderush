import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { Key } from '../components/Key';
import { drawWinCard, type WinCard } from './winCard';

/**
 * The card, and the three ways off the machine.
 *
 * Sharing an image is one of the few things browsers still disagree about, so
 * there are three routes rather than one that works on the developer's laptop:
 * the share sheet where the OS has one, the clipboard where it does not — X
 * takes a pasted image but not a linked one — and a plain save as the floor.
 */
export function ShareSheet({
  card, host, onClose,
}: {
  card: WinCard | null;
  host: HTMLElement | null;
  onClose: () => void;
}) {
  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!card) { setPng(null); setSaid(null); setError(null); return; }
    let alive = true;
    let url: string | null = null;
    void drawWinCard(card)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setPng({ blob, url });
      })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [card]);

  if (!host) return null;

  const text = card
    ? `${card.payout} on ${card.market}${card.multiple ? ` · ${card.multiple}` : ''} — Trade Rush`
    : '';

  const file = () => new File([png!.blob], 'trade-rush.png', { type: 'image/png' });

  const share = async () => {
    if (!png) return;
    try {
      if (navigator.canShare?.({ files: [file()] })) {
        await navigator.share({ files: [file()], text });
        return;
      }
      await copy();
    } catch (e) {
      // A share the person cancelled is not a failure and must not be reported
      // as one.
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    }
  };

  const copy = async () => {
    if (!png) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png.blob })]);
      setSaid('Copied. Paste it into the post.');
    } catch {
      setError('This browser will not take an image on the clipboard — save it instead.');
    }
  };

  const post = () => {
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <Drawer.Root open={card !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Drawer.Portal container={host}>
        <Drawer.Overlay className="sheet__scrim" />
        <Drawer.Content className="sheet" aria-describedby={undefined}>
          <Drawer.Title className="sheet__title">Your card</Drawer.Title>
          <div className="sheet__grip" aria-hidden />
          <div className="sheet__body">
            <div className="cardframe">
              {png
                ? <img src={png.url} alt="Your result, as a card" />
                : <div className="cardframe__wait">{error ?? 'drawing…'}</div>}
            </div>

            <div className="calls calls--act">
              <Key disabled={!png} onPress={() => void copy()}>
                <span className="nm">copy image</span>
              </Key>
              <Key lit={Boolean(png)} disabled={!png} onPress={() => void share()}>
                <span className="nm">share</span>
              </Key>
            </div>

            <div className="calls calls--act">
              <Key disabled={!png} onPress={post}>
                <span className="nm">post on X</span>
              </Key>
              <Key onPress={onClose}><span className="nm">done</span></Key>
            </div>

            <p className="hint">
              {said ?? (png
                ? 'X takes a pasted image, not a linked one — copy first, then post.'
                : 'Building the card…')}
            </p>
            {error && !said && <p className="hint hint--warn">{error}</p>}

            {png && (
              <p className="hint">
                <a href={png.url} download="trade-rush.png">save the image</a>
              </p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
