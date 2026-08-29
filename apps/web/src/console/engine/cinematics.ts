import type { Attack, Particle, Tally } from './types';
import { burst } from './fx';
import {
  drawBull, drawBear, drawBullPaw, drawBullCharge, drawBullStomp,
  drawBearRear, drawBearBite, drawBearSlam,
  drawRunner, drawRunnerHit, drawRunnerLimp, drawRunnerBrace, drawRunnerPose,
} from './sprites';

/** The three finish-line cinematics.
 *
 *  Each is a timeline: `p` runs 0..1 over the attack's duration and the beats are
 *  laid out as ascending thresholds, so reading top to bottom reads the shot list.
 *  Sound is scheduled separately (see Engine.resolve) — these only draw.
 *
 *  Every function returns the shake it wants this frame; the caller takes the max.
 */

export interface CinemaEnv {
  frame: number;
  particles: Particle[];
  w: number;
  h: number;
}

const GOLD = '255,215,119';
const BULL_COL = '#5BF0A6';
const BEAR_COL = '#FF7566';

/** WIN — the animal charges, you hold, it is thrown back, you pose. */
export function drawStand(c: CanvasRenderingContext2D, atk: Attack, env: CinemaEnv): number {
  const p = Math.min(1, atk.t / 1900);
  const { x: ax, y: ay } = atk;
  const kf = Math.floor(env.frame / 2);
  const isBull = atk.beast === 'bull';
  const col = isBull ? BULL_COL : BEAR_COL;
  const rgb = isBull ? '91,240,166' : '255,150,130';
  let shake = 0;

  if (p < 0.20) {
    // It closes. Speed lines behind it, you plant your feet.
    const k = p / 0.20;
    const bx = ax - 92 + k * 62;
    c.strokeStyle = `rgba(${rgb},.45)`;
    c.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const yy = ay - 16 + i * 5;
      c.beginPath(); c.moveTo(bx - 16 - i * 7, yy); c.lineTo(bx - 36 - i * 9, yy); c.stroke();
    }
    isBull ? drawBullCharge(c, bx, ay, 1.4, col, kf) : drawBear(c, bx, ay, 1.4, kf, col);
    drawRunnerBrace(c, ax, ay, k);
    if (env.frame % 2 === 0) burst(env.particles, ax - 6, ay + 2, 2, GOLD, 4);
    shake = 2 + k * 6;

  } else if (p < 0.32) {
    // Impact. The screen dims and a white ring snaps outward.
    const k = (p - 0.20) / 0.12;
    c.fillStyle = `rgba(0,0,0,${(0.42 * (1 - k * 0.3)).toFixed(2)})`;
    c.fillRect(0, 0, env.w, env.h);
    isBull ? drawBullCharge(c, ax - 30, ay, 1.45, col, kf) : drawBear(c, ax - 30, ay, 1.45, kf, col);
    drawRunnerBrace(c, ax, ay, 1);
    c.save();
    c.globalAlpha = 1 - k; c.strokeStyle = '#FFFFFF'; c.lineWidth = 3 - k * 2;
    c.beginPath(); c.arc(ax - 14, ay - 8, 6 + k * 30, 0, 7); c.stroke();
    c.restore();
    shake = 13;

  } else if (p < 0.55) {
    // The repel: a gold shockwave, and the animal tumbles away.
    const k = (p - 0.32) / 0.23;
    c.save();
    c.globalAlpha = (1 - k) * 0.95; c.lineWidth = 4 - k * 3;
    c.strokeStyle = '#FFD777'; c.shadowColor = '#FFC857'; c.shadowBlur = 18;
    c.beginPath(); c.arc(ax, ay - 8, 14 + k * 170, 0, 7); c.stroke();
    c.globalAlpha = (1 - k) * 0.5; c.lineWidth = 2;
    c.beginPath(); c.arc(ax, ay - 8, 6 + k * 120, 0, 7); c.stroke();
    c.restore();

    const bx = ax - 30 - k * 210;
    const by = ay - k * 30 + k * k * 22;
    c.save();
    c.translate(bx, by); c.rotate(k * 7); c.globalAlpha = 1 - k * 0.5;
    isBull ? drawBullCharge(c, 0, 0, 1.3, col, kf) : drawBear(c, 0, 0, 1.3, kf, col);
    c.restore();
    c.globalAlpha = 1;
    if (env.frame % 2 === 0) burst(env.particles, bx, by, 2, rgb, 6);
    drawRunnerBrace(c, ax, ay, 1);
    shake = 10 * (1 - k);

  } else {
    // The pose: rotating rays, a column of light, embers rising.
    const k = Math.min(1, (p - 0.55) / 0.30);
    c.save();
    c.translate(ax, ay - 10); c.rotate(env.frame * 0.02);
    c.strokeStyle = `rgba(255,215,119,${(0.16 + 0.14 * Math.sin(env.frame * 0.2)).toFixed(3)})`;
    c.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5;
      c.beginPath();
      c.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
      c.lineTo(Math.cos(a) * (30 + k * 58), Math.sin(a) * (30 + k * 58));
      c.stroke();
    }
    c.restore();

    const g = c.createLinearGradient(0, ay, 0, 0);
    g.addColorStop(0, `rgba(255,215,119,${(0.30 * k).toFixed(2)})`);
    g.addColorStop(1, 'rgba(255,215,119,0)');
    c.fillStyle = g;
    c.fillRect(ax - 16, 0, 32, ay);

    if (env.frame % 2 === 0) {
      env.particles.push({
        x: ax + (Math.random() - 0.5) * 22, y: ay,
        vx: (Math.random() - 0.5) * 0.7, vy: -1.6 - Math.random(),
        life: 1, col: GOLD, sz: 2,
      });
    }
    drawRunnerPose(c, ax, ay, k);
  }
  return shake;
}

/** LOSS to the bull — paw, charge, gore, toss, stomp. */
export function drawGore(c: CanvasRenderingContext2D, atk: Attack, env: CinemaEnv): number {
  const p = Math.min(1, atk.t / 2150);
  const { x: ax, y: ay } = atk;
  const kf = Math.floor(env.frame / 2);
  let shake = 0;

  if (p < 0.12) {
    const k = p / 0.12;
    drawBullPaw(c, ax - 40, ay, 1.35, BULL_COL, kf);
    if (env.frame % 2 === 0) burst(env.particles, ax - 52, ay + 2, 2, '120,230,170', 4);
    drawRunner(c, ax, ay, -0.12);
    if (k > 0.5 && env.frame % 6 === 0) shake = 2;

  } else if (p < 0.24) {
    const k = (p - 0.12) / 0.12;
    const bx = ax - 40 + k * 38;
    c.strokeStyle = 'rgba(91,240,166,.5)'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const yy = ay - 16 + i * 5;
      c.beginPath(); c.moveTo(bx - 18 - i * 7, yy); c.lineTo(bx - 40 - i * 9, yy); c.stroke();
    }
    drawBullCharge(c, bx, ay, 1.4, BULL_COL, kf);
    drawRunner(c, ax, ay, -0.2);
    if (env.frame % 2 === 0) burst(env.particles, bx - 14, ay + 2, 2, '120,230,170', 5);
    shake = 4 + k * 8;

  } else if (p < 0.29) {
    // Contact.
    const k = (p - 0.24) / 0.05;
    drawBullCharge(c, ax - 2, ay, 1.45, BULL_COL, kf);
    c.save();
    c.globalAlpha = 1 - k; c.strokeStyle = '#FFFFFF'; c.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      c.beginPath();
      c.moveTo(ax + Math.cos(a) * 8, ay - 8 + Math.sin(a) * 8);
      c.lineTo(ax + Math.cos(a) * (16 + k * 22), ay - 8 + Math.sin(a) * (16 + k * 22));
      c.stroke();
    }
    c.restore();
    drawRunnerHit(c, ax + k * 8, ay - 6, -0.5, '#FFFFFF');
    shake = 16;

  } else if (p < 0.56) {
    // Tossed on an arc.
    const k = (p - 0.29) / 0.27;
    drawBullCharge(c, ax - 6, ay, 1.4, BULL_COL, kf);
    const rx = ax + k * 46;
    const ry = ay - 84 * Math.sin(k * Math.PI) + k * k * 10;
    drawRunnerHit(c, rx, ry, k * 9, k < 0.25 ? '#FFFFFF' : '#FFD777');
    if (env.frame % 2 === 0) burst(env.particles, rx, ry, 2, '255,90,72', 5);

  } else if (p < 0.67) {
    const k = (p - 0.56) / 0.11;
    drawBull(c, ax - 14 + k * 30, ay, 1.25, kf, BULL_COL);
    if (k < 0.14) burst(env.particles, ax + 48, ay + 2, 7, '200,190,160', 6);
    drawRunnerLimp(c, ax + 48, ay + 2);

  } else if (p < 0.80) {
    const k = (p - 0.67) / 0.13;
    drawBullStomp(c, ax + 30, ay, 1.35, BULL_COL, k * 10);
    drawRunnerLimp(c, ax + 48, ay + 2);
    if (k > 0.7 && env.frame % 3 === 0) shake = 3;

  } else if (p < 0.87) {
    // The stomp lands.
    const k = (p - 0.80) / 0.07;
    drawBullStomp(c, ax + 30, ay, 1.4, BULL_COL, -2);
    c.save();
    c.globalAlpha = 1 - k; c.strokeStyle = '#FFFFFF'; c.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const a = Math.PI + i * Math.PI / 9;
      c.beginPath();
      c.moveTo(ax + 48 + Math.cos(a) * 6, ay + 2 + Math.sin(a) * 6);
      c.lineTo(ax + 48 + Math.cos(a) * (14 + k * 34), ay + 2 + Math.sin(a) * (14 + k * 34));
      c.stroke();
    }
    c.restore();
    if (k < 0.2) burst(env.particles, ax + 48, ay + 2, 12, '255,90,72', 9);
    shake = 20;

  } else {
    drawBullStomp(c, ax + 26, ay, 1.35, BULL_COL, 4);
    drawRunnerLimp(c, ax + 48, ay + 3, '#8A6A3A');
  }
  return shake;
}

/** LOSS to the bear — rear, swipe, bite, shake, throw, slam. */
export function drawClaw(c: CanvasRenderingContext2D, atk: Attack, env: CinemaEnv): number {
  const p = Math.min(1, atk.t / 2150);
  const { x: ax, y: ay } = atk;
  const kf = Math.floor(env.frame / 2);
  let shake = 0;

  if (p < 0.15) {
    const k = p / 0.15;
    drawBearRear(c, ax - 30, ay + 4, 1.3, BEAR_COL, -1.5 + k * 0.7);
    drawRunner(c, ax, ay, 0.1);
    shake = 2 + k * 4;

  } else if (p < 0.24) {
    const k = (p - 0.15) / 0.09;
    drawBearRear(c, ax - 26, ay + 4, 1.35, BEAR_COL, -0.8 + k * 2.2);
    drawRunnerHit(c, ax + k * 6, ay - 2, 0.3, k > 0.4 ? '#FFFFFF' : '#FFD777');
    shake = 10;

  } else if (p < 0.34) {
    // Jaws close.
    const k = (p - 0.24) / 0.10;
    drawBearBite(c, ax - 12 + k * 8, ay, 1.4, BEAR_COL, Math.max(0, 6 - k * 9));
    drawRunnerHit(c, ax + 8, ay - 4, 0.5, '#FFFFFF');
    if (env.frame % 2 === 0) burst(env.particles, ax + 8, ay - 4, 3, '255,90,72', 6);
    shake = 14;

  } else if (p < 0.55) {
    // Shaken side to side.
    const k = (p - 0.34) / 0.21;
    const sw = Math.sin(k * Math.PI * 7) * 7;
    drawBearBite(c, ax - 4 + sw * 0.4, ay, 1.4, BEAR_COL, 0);
    drawRunnerHit(c, ax + 13 + sw, ay - 5 + Math.cos(k * Math.PI * 7) * 3, 0.5 + sw * 0.05, '#FFD777');
    if (env.frame % 3 === 0) burst(env.particles, ax + 13, ay - 5, 2, '255,90,72', 5);
    shake = 5 + Math.abs(sw);

  } else if (p < 0.68) {
    // Thrown away.
    const k = (p - 0.55) / 0.13;
    drawBear(c, ax - 16, ay, 1.25, kf, BEAR_COL);
    const rx = ax + 16 + k * 52;
    const ry = ay - 40 * Math.sin(k * Math.PI) + k * k * 14;
    if (k < 0.85) drawRunnerHit(c, rx, ry, k * 7, '#FFD777');
    else {
      if (k < 0.9) burst(env.particles, rx, ry, 7, '200,190,160', 6);
      drawRunnerLimp(c, rx, ry);
    }

  } else if (p < 0.80) {
    const k = (p - 0.68) / 0.12;
    drawBearSlam(c, ax + 18 + k * 22, ay, 1.35, BEAR_COL, -16 * k);
    drawRunnerLimp(c, ax + 68, ay + 2);

  } else if (p < 0.88) {
    // Both arms land.
    const k = (p - 0.80) / 0.08;
    drawBearSlam(c, ax + 40, ay, 1.4, BEAR_COL, 6);
    c.save();
    c.globalAlpha = (1 - k) * 0.95; c.strokeStyle = '#FFD9CE'; c.lineWidth = 3 - k * 2;
    c.shadowColor = 'rgba(255,90,72,.9)'; c.shadowBlur = 14;
    for (let m = 0; m < 4; m++) {
      const o = m * 10 - 15;
      c.beginPath(); c.moveTo(ax + 62 + o, ay - 34); c.lineTo(ax + 42 + o + k * 26, ay + 18); c.stroke();
    }
    c.restore();
    if (k < 0.2) burst(env.particles, ax + 66, ay + 2, 14, '255,90,72', 9);
    shake = 20;

  } else {
    drawBearSlam(c, ax + 40, ay, 1.35, BEAR_COL, 4);
    drawRunnerLimp(c, ax + 68, ay + 3, '#8A6A3A');
  }
  return shake;
}

export function drawCinematic(c: CanvasRenderingContext2D, atk: Attack, env: CinemaEnv): number {
  if (atk.type === 'stand') return drawStand(c, atk, env);
  if (atk.type === 'gore') return drawGore(c, atk, env);
  return drawClaw(c, atk, env);
}


/* ------------------------------------------------------------ the settlement tally

   The timeline is shared with the engine, which schedules the sounds against
   these same numbers — a pop that lands 80ms off the thing it belongs to reads
   as a different, worse machine, and two copies of the beat drift apart the
   first time either is tuned.

   The shape of it is borrowed from Balatro, and so is the reason it works: one
   reward is broken into several arrivals, each with its own sound a step higher
   than the last, and the biggest one is preceded by silence. */

/** The stake box flies in. */
export const T_STAKE = 300;
/** The odds settle into it. */
export const T_ODDS = 560;
/** …and then nothing happens for four hundred milliseconds. The gap is the
 *  single most effective thing in here: anticipation is the reward. */
export const T_MULT = 1220;
/** The two boxes collide. */
export const T_SLAM = 1540;
/** How long the number takes to climb (or, on a loss, to drain away). */
export const T_COUNT = 620;
/** First breakdown line. */
export const T_ITEM_0 = T_SLAM + T_COUNT + 170;
export const T_ITEM_STEP = 230;

export const tallyItemAt = (i: number): number => T_ITEM_0 + i * T_ITEM_STEP;
export const tallyEndAt = (items: number): number => tallyItemAt(Math.max(0, items - 1)) + 260;

/** Ease-out-back: overshoots, then settles. The overshoot is the whole point —
 *  a value that arrives at its final size is placed, one that overshoots is
 *  thrown. */
const back = (k: number): number => {
  const t = k - 1;
  return 1 + t * t * (2.70158 * t + 1.70158);
};

const ease = (k: number): number => 1 - (1 - k) ** 3;

/** Deterministic pseudo-random in 0..1. The celebration must look scattered and
 *  be reproducible from `t` alone — nothing here is allowed to hold state. */
const rnd = (i: number): number => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Light rays turning behind the plaque. The cheapest way to make a number look
 *  like an event rather than a readout. */
function drawRays(c: CanvasRenderingContext2D, cx: number, cy: number, k: number, w: number, h: number, t: number): void {
  const R = Math.hypot(w, h);
  c.save();
  c.translate(cx, cy);
  c.rotate(t / 2600);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, R, a - 0.11, a + 0.11);
    c.closePath();
    c.fillStyle = `rgba(255,200,87,${(0.05 + 0.035 * Math.sin(t / 300 + i)) * k})`;
    c.fill();
  }
  c.restore();
}

/** Falling gold. Drawn from `t`, so it is the same shower every time and costs
 *  no particle array. */
function drawConfetti(c: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  const COLS = ['255,200,87', '255,215,119', '91,240,166', '255,255,255'];
  for (let i = 0; i < 46; i++) {
    const x = rnd(i + 90) * w;
    const y = ((t / 1000) * (42 + rnd(i) * 90) + rnd(i + 7) * h * 2) % (h + 30) - 15;
    const sw = 2.5 + rnd(i + 3) * 2;
    c.save();
    c.translate(x, y);
    c.rotate(t / 260 + i);
    c.fillStyle = `rgba(${COLS[i % COLS.length]},.85)`;
    c.fillRect(-sw / 2, -3, sw, 6);
    c.restore();
  }
}

/** A rounded plaque with a lit edge. */
function plaque(c: CanvasRenderingContext2D, x: number, y: number, pw: number, ph: number, glow: number, win: boolean): void {
  const edge = win ? '255,200,87' : '255,90,72';
  c.save();
  c.beginPath();
  c.roundRect(x, y, pw, ph, 9);
  const g = c.createLinearGradient(0, y, 0, y + ph);
  g.addColorStop(0, 'rgba(20,24,27,.98)');
  g.addColorStop(1, 'rgba(6,8,9,.98)');
  c.fillStyle = g;
  c.shadowColor = `rgba(${edge},${0.5 * glow})`;
  c.shadowBlur = 26 * glow;
  c.fill();
  c.shadowBlur = 0;
  c.lineWidth = 1.5;
  c.strokeStyle = `rgba(${edge},${0.55 + 0.35 * glow})`;
  c.stroke();
  c.restore();
}

/** One of the two boxes that collide. Balatro's blue-and-red pair: what you
 *  brought, and what the table does to it. */
function box(
  c: CanvasRenderingContext2D,
  cx: number, cy: number, bw: number, bh: number,
  label: string, value: string, rgb: string, k: number, big: boolean,
): void {
  const pop = back(Math.min(1, k));
  c.save();
  c.translate(cx, cy);
  c.scale(0.5 + 0.5 * pop, 0.5 + 0.5 * pop);
  c.beginPath();
  c.roundRect(-bw / 2, -bh / 2, bw, bh, 5);
  c.fillStyle = `rgba(${rgb},.16)`;
  c.fill();
  c.lineWidth = 1;
  c.strokeStyle = `rgba(${rgb},.75)`;
  c.stroke();

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '400 8px Share Tech Mono, monospace';
  c.fillStyle = `rgba(${rgb},.75)`;
  c.fillText(label.toUpperCase(), 0, -bh / 2 + 8);
  c.font = `700 ${big ? 20 : 16}px Barlow Condensed, sans-serif`;
  c.shadowColor = `rgba(${rgb},.9)`;
  c.shadowBlur = big ? 14 : 8;
  c.fillStyle = `rgb(${rgb})`;
  c.fillText(value, 0, bh / 2 - 12);
  c.shadowBlur = 0;
  c.restore();
}

/**
 * Draw the result card: the verdict, the two boxes, the collision, the number
 * and its breakdown.
 *
 * The card owns its whole layout — title included. Splitting the title across
 * two drawing sites is what put "HELD THE LINE" through the middle of the STAKE
 * row: two owners, one column of glass, and neither of them measuring.
 *
 * `t` is ms since the card appeared. Every beat is derived from it rather than
 * held as state, so the card can be drawn at any point in its life — a frame
 * dropped, a tab restored — and looks exactly as far along as the clock says.
 *
 * Returns the shake it wants this frame.
 */
export function drawTally(
  c: CanvasRenderingContext2D,
  T: Tally,
  title: string,
  t: number,
  env: CinemaEnv,
): number {
  const { w, h } = env;
  const win = T.win;
  const cx = w / 2;
  const cy = h / 2;
  let shake = 0;

  if (win && t > T_SLAM) drawRays(c, cx, cy, Math.min(1, (t - T_SLAM) / 500), w, h, t);

  // ---- the plaque ---------------------------------------------------------
  const lines = win ? T.items.length : (T.missedBy ? 1 : 0);
  const TITLE_H = 22, ZONE_H = 48, LINE_H = 14;
  const pw = Math.min(w - 26, 286);
  const ph = 10 + TITLE_H + 6 + ZONE_H + 8 + lines * LINE_H + 20;
  const px = cx - pw / 2;
  const py = cy - ph / 2;

  // The gap before the multiplier is silent, but not still: the plaque strains.
  const strain = t > T_ODDS + 120 && t < T_MULT ? (t - T_ODDS - 120) / (T_MULT - T_ODDS - 120) : 0;
  if (strain > 0) shake = strain * 3;
  const glow = t < T_SLAM ? 0.25 + strain * 0.5 : 0.6 + 0.4 * Math.sin((t - T_SLAM) / 220);
  plaque(c, px, py, pw, ph, glow, win);

  // ---- the verdict --------------------------------------------------------
  const tk = Math.min(1, t / 260);
  c.save();
  c.translate(cx, py + 10 + TITLE_H / 2);
  c.scale(0.7 + 0.3 * back(tk), 0.7 + 0.3 * back(tk));
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '700 20px Barlow Condensed, sans-serif';
  c.shadowColor = win ? 'rgba(255,200,87,.9)' : 'rgba(255,90,72,.9)';
  c.shadowBlur = 16;
  c.fillStyle = win ? '#FFD777' : '#FF7566';
  c.fillText(title, 0, 0);
  c.shadowBlur = 0;
  c.restore();

  // ---- the two boxes, and their collision ---------------------------------
  const zoneY = py + 10 + TITLE_H + 6 + ZONE_H / 2;
  const BW = 96, BH = 40;
  const MULT_RGB = win ? '255,200,87' : '255,90,72';

  if (t < T_SLAM) {
    // Sliding in from opposite edges, so the collision has somewhere to come
    // from. The stake is what you own; the multiple arrives from outside.
    const sk = Math.min(1, (t - T_STAKE) / 260);
    if (sk > 0) {
      const x = cx - BW / 2 - 5 - (1 - ease(sk)) * 70;
      box(c, x, zoneY, BW, BH, 'stake', T.stake, '198,202,206', sk, false);
      if (t >= T_ODDS) {
        const ok = Math.min(1, (t - T_ODDS) / 200);
        c.save();
        c.globalAlpha = ok;
        c.textAlign = 'center';
        c.font = '400 8px Share Tech Mono, monospace';
        c.fillStyle = 'rgba(198,202,206,.6)';
        c.fillText(`${T.oddsPct}% BOOK`, x, zoneY + BH / 2 + 9);
        c.restore();
      }
    }
    if (t >= T_MULT) {
      const mk = Math.min(1, (t - T_MULT) / 240);
      const x = cx + BW / 2 + 5 + (1 - ease(mk)) * 70;
      box(c, x, zoneY, BW, BH, win ? 'pays' : 'wrong side', `×${win ? T.mult.toFixed(2) : '0'}`, MULT_RGB, mk, true);
      if (mk < 0.4) shake = Math.max(shake, win ? 6 : 4);
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '700 15px Barlow Condensed, sans-serif';
      c.fillStyle = `rgba(${MULT_RGB},${mk})`;
      c.fillText('×', cx, zoneY);
      c.restore();
    }
  } else {
    // ---- the number -------------------------------------------------------
    const k = Math.min(1, (t - T_SLAM) / T_COUNT);
    // A win climbs from nothing. A loss DRAINS from what you had: watching the
    // stake you already owned run down to zero is a different feeling from a
    // zero that was simply always there, and it is the one that stings.
    const from = win ? 0 : T.total + Math.abs(T.net);
    const shown = Math.round(from + (T.total - from) * ease(k));
    const punch = back(Math.min(1, (t - T_SLAM) / 260));
    if (t - T_SLAM < 90) shake = Math.max(shake, win ? 13 : 8);

    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.translate(cx, zoneY);
    c.scale(0.3 + 0.7 * punch, 0.3 + 0.7 * punch);
    c.font = '700 36px Barlow Condensed, sans-serif';
    c.shadowColor = `rgba(${MULT_RGB},.95)`;
    c.shadowBlur = 18 + (1 - k) * 32;
    c.fillStyle = win ? '#FFD777' : '#FF7566';
    c.fillText(shown.toLocaleString('en-US'), 0, 0);
    c.restore();

    // ---- the breakdown ----------------------------------------------------
    const listY = py + 10 + TITLE_H + 6 + ZONE_H + 8;
    c.textBaseline = 'middle';
    T.items.forEach((it, i) => {
      const at = tallyItemAt(i);
      if (t < at) return;
      const ik = Math.min(1, (t - at) / 200);
      const y = listY + i * LINE_H + LINE_H / 2;
      c.save();
      c.globalAlpha = ik;
      c.textAlign = 'left';
      c.font = '400 9px Share Tech Mono, monospace';
      c.fillStyle = 'rgba(198,202,206,.6)';
      c.fillText(it.label.toUpperCase(), px + 16, y);
      c.textAlign = 'right';
      c.font = '700 12px Barlow Condensed, sans-serif';
      c.fillStyle = it.tone === 'gold' ? '#FFC857' : it.tone === 'up' ? '#5BF0A6' : '#FF7566';
      c.fillText(it.value, px + pw - 16 + (1 - ik) * 12, y);
      c.restore();
    });

    // A loss gets the one line that matters instead: how close it was. The
    // brain treats a near miss like a win, which is exactly why it is here and
    // exactly why it is worth being deliberate about.
    if (!win && T.missedBy && t > T_ITEM_0) {
      const ik = Math.min(1, (t - T_ITEM_0) / 220);
      c.save();
      c.globalAlpha = ik;
      c.textAlign = 'center';
      c.font = `700 ${T.nearMiss ? 13 : 10}px Barlow Condensed, sans-serif`;
      c.fillStyle = T.nearMiss ? '#FFC857' : 'rgba(198,202,206,.65)';
      c.fillText(T.nearMiss ? `SO CLOSE · MISSED BY ${T.missedBy}` : `MISSED BY ${T.missedBy}`,
                 cx, listY + LINE_H / 2);
      c.restore();
    }

    // ---- the net, once everything has landed ------------------------------
    const netAt = tallyEndAt(lines);
    if (t > netAt) {
      const nk = Math.min(1, (t - netAt) / 200);
      c.save();
      c.globalAlpha = nk;
      c.textAlign = 'center';
      c.font = '400 11px Share Tech Mono, monospace';
      c.fillStyle = T.net >= 0 ? 'rgba(91,240,166,.95)' : 'rgba(255,117,102,.95)';
      c.fillText(`${T.net >= 0 ? '+' : ''}${T.net.toLocaleString('en-US')} PTS`,
                 cx, py + ph - 11);
      c.restore();
    }
  }

  // ---- the streak, top right of the plaque --------------------------------
  // Something you can LOSE holds harder than something you can win. It appears
  // with the breakdown, once the number is already yours.
  if (T.streak >= 2 && t > T_ITEM_0) {
    const sk = Math.min(1, (t - T_ITEM_0) / 260);
    const bw = 62, bh = 17;
    const bx = px + pw - bw / 2 - 8;
    const by = py - 2;
    c.save();
    c.translate(bx, by);
    c.scale(0.4 + 0.6 * back(sk), 0.4 + 0.6 * back(sk));
    c.beginPath();
    c.roundRect(-bw / 2, -bh / 2, bw, bh, 8);
    c.fillStyle = `rgba(255,200,87,${0.14 + 0.06 * Math.sin(t / 180)})`;
    c.fill();
    c.strokeStyle = 'rgba(255,200,87,.85)';
    c.lineWidth = 1;
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '700 10px Barlow Condensed, sans-serif';
    c.shadowColor = 'rgba(255,200,87,.9)';
    c.shadowBlur = 10;
    c.fillStyle = '#FFD777';
    c.fillText(`${T.streak} IN A ROW`, 0, 0);
    c.restore();
  }

  if (win && t > T_SLAM + 60) drawConfetti(c, t - T_SLAM, w, h);

  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  return shake;
}
