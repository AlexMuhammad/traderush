/** Everything the card prints. Nothing is derived inside the drawing code — a
 *  card that computes its own numbers is a second place for them to be wrong. */
export interface WinCard {
  /** "BTC · 1M" */
  market: string;
  side: 'up' | 'down' | null;
  /** Already formatted, with symbol. */
  payout: string;
  /** Optional, and omitted rather than faked when the cost is not known. */
  stake?: string;
  multiple?: string;
  net?: string;
  strike?: string;
  close?: string;
}

const W = 1200;
const H = 675;

const UP = '#3FD98B';
const DOWN = '#FF5A48';
const LAMP = '#FFC857';

/** Load an image from our own origin. Same-origin keeps the canvas untainted,
 *  which is what lets `toBlob` produce a file at all. */
function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/**
 * Draw the card people put on a timeline.
 *
 * The console's own materials — brushed plate, recessed glass, the amber lamp —
 * because a screenshot of the machine is what someone would have posted anyway.
 * It is built at a fixed 1200x675 rather than from the live DOM: the console is
 * 384px wide and a photo of it reads as a phone screenshot, not as a card.
 */
export async function drawWinCard(card: WinCard): Promise<Blob> {
  // Wait for the faces, or the first card of a session renders in Times.
  await (document.fonts?.ready ?? Promise.resolve());
  const [wordmark, badge] = await Promise.all([load('/wordmark.png'), load('/badge.png')]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;

  const tone = card.side === 'down' ? DOWN : UP;

  // ---- ground -------------------------------------------------------------
  const bg = c.createRadialGradient(W / 2, 0, 40, W / 2, 0, H * 1.5);
  bg.addColorStop(0, '#2A2E31');
  bg.addColorStop(1, '#0E1012');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // The wallpaper, at the same whisper it runs at in the app.
  if (wordmark) {
    c.save();
    c.globalAlpha = 0.05;
    for (let y = -40; y < H; y += 130) {
      for (let x = -60; x < W; x += 390) c.drawImage(wordmark, x, y, 360, 120);
    }
    c.restore();
  }

  // ---- the plate ----------------------------------------------------------
  const px = 64, py = 56, pw = W - 128, ph = H - 112;
  const steel = c.createLinearGradient(px, py, px + pw, py + ph);
  steel.addColorStop(0, '#C6CACE');
  steel.addColorStop(0.38, '#9AA0A5');
  steel.addColorStop(1, '#5E6469');
  roundRect(c, px, py, pw, ph, 22);
  c.fillStyle = steel;
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,.75)';
  c.lineWidth = 2;
  c.stroke();

  // ---- the glass ----------------------------------------------------------
  const gx = px + 34, gy = py + 96, gw = pw - 68, gh = ph - 178;
  const glass = c.createLinearGradient(0, gy, 0, gy + gh);
  glass.addColorStop(0, '#1A1D20');
  glass.addColorStop(1, '#0A0B0C');
  roundRect(c, gx, gy, gw, gh, 14);
  c.fillStyle = glass;
  c.fill();

  // ---- plate header -------------------------------------------------------
  if (badge) c.drawImage(badge, px + 34, py + 30, 40, 40);
  c.fillStyle = '#3A4045';
  c.font = "700 26px 'Barlow Condensed', sans-serif";
  c.textBaseline = 'middle';
  c.fillText('TRADE RUSH', px + 88, py + 51);

  c.font = "400 22px 'Share Tech Mono', monospace";
  c.fillStyle = '#5C6469';
  const head = card.market.toUpperCase();
  c.fillText(head, px + pw - 34 - c.measureText(head).width, py + 51);

  // ---- the side -----------------------------------------------------------
  const sideLabel = card.side === null ? 'SETTLED' : card.side.toUpperCase();
  c.font = "700 30px 'Barlow Condensed', sans-serif";
  c.fillStyle = tone;
  c.fillText(sideLabel, gx + 44, gy + 58);

  // A triangle, the same mark the keys carry.
  if (card.side) {
    const ax = gx + 44 + c.measureText(sideLabel).width + 22;
    const ay = gy + 58;
    c.beginPath();
    if (card.side === 'up') { c.moveTo(ax, ay - 13); c.lineTo(ax + 24, ay + 11); c.lineTo(ax - 24, ay + 11); }
    else { c.moveTo(ax, ay + 13); c.lineTo(ax + 24, ay - 11); c.lineTo(ax - 24, ay - 11); }
    c.closePath();
    c.fillStyle = tone;
    c.fill();
  }

  // ---- the number ---------------------------------------------------------
  c.fillStyle = LAMP;
  c.font = "700 132px 'Barlow Condensed', sans-serif";
  c.shadowColor = 'rgba(255,200,87,.55)';
  c.shadowBlur = 40;
  c.fillText(card.payout, gx + 44, gy + 168);
  c.shadowBlur = 0;

  c.font = "400 26px 'Share Tech Mono', monospace";
  c.fillStyle = '#6E757A';
  c.fillText('PAID OUT', gx + 46, gy + 236);

  // ---- the supporting figures, only the ones we actually know -------------
  const facts: [string, string, string][] = [];
  if (card.multiple) facts.push(['MULTIPLE', card.multiple, LAMP]);
  if (card.stake) facts.push(['STAKE', card.stake, '#D6DADD']);
  if (card.net) facts.push(['NET', card.net, card.net.startsWith('-') ? DOWN : UP]);
  if (card.strike && card.close) facts.push(['STRIKE → CLOSE', `${card.strike} → ${card.close}`, '#D6DADD']);

  let fy = gy + 300;
  for (const [label, value, colour] of facts.slice(0, 3)) {
    c.font = "400 20px 'Share Tech Mono', monospace";
    c.fillStyle = '#565D63';
    c.fillText(label, gx + 46, fy);
    c.font = "700 34px 'Barlow Condensed', sans-serif";
    c.fillStyle = colour;
    const vw = c.measureText(value).width;
    c.fillText(value, gx + gw - 46 - vw, fy);
    fy += 52;
  }

  // ---- footer -------------------------------------------------------------
  c.font = "400 20px 'Share Tech Mono', monospace";
  c.fillStyle = '#41474C';
  c.fillText('LIVE · TESTNET · CHAIN 50312', px + 34, py + ph - 28);
  const tag = 'traderush';
  c.fillStyle = '#5C6469';
  c.fillText(tag, px + pw - 34 - c.measureText(tag).width, py + ph - 28);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the card could not be drawn'))), 'image/png');
  });
}
