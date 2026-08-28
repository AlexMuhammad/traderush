import type { Audio } from './audio';
import type { Particle, Ring } from './types';
import {
  drawBull, drawBear, drawBullPaw, drawBullThrust, drawBullStomp,
  drawBearRear, drawBearSwipe,
} from './sprites';

/** Idle behaviour for the two animals.
 *
 *  Each animal picks a move, plays it for a duration, then picks again. Which
 *  moves are eligible depends on `aggression`, which climbs across the window —
 *  so the same code grazes early and bellows at the end without a separate mode.
 */

export type Move = 'graze' | 'trot' | 'snort' | 'scrape' | 'lunge' | 'strike' | 'bellow';

export interface BeastState {
  mv: Move;
  /** ms into the current move. */
  mt: number;
  /** ms the current move lasts. */
  dur: number;
  /** One-shot latch, so a move's sound and impulse fire once, not every frame. */
  fired: boolean;
}

export const newBeastState = (dur: number): BeastState => ({ mv: 'trot', mt: 0, dur, fired: false });

export interface BeastEnv {
  frame: number;
  particles: Particle[];
  rings: Ring[];
  audio: Audio;
  /** Raise the screen shake to at least this. */
  shake: (n: number) => void;
}

export interface BeastDraw {
  x: number; y: number;
  /** Base sprite scale before the aggression bonus. */
  base: number;
  /** 0..1. Drives move choice, gait speed, glow and sprite scale. */
  aggression: number;
  col: string;
  /** The same colour as an "r,g,b" triple, for particles. */
  rgb: string;
  /** 0..1 fade. The ally fades out once you have picked a side. */
  alpha: number;
  /** This animal is the one hunting you — full brightness, sound enabled. */
  hot: boolean;
  dt: number;
  isBull: boolean;
  trading: boolean;
}

/** Pick the next move. Weighted so aggression gates what is even possible. */
function nextMove(aggression: number, isBull: boolean): { mv: Move; dur: number } {
  const r = Math.random();
  if (aggression < 0.12) return { mv: 'graze', dur: 1400 + Math.random() * 1600 };
  if (aggression > 0.76 && r < 0.24) return { mv: 'bellow', dur: 640 };
  if (aggression > 0.50 && r < 0.52) return { mv: 'strike', dur: isBull ? 520 : 560 };
  if (aggression > 0.56 && r < 0.66) return { mv: 'lunge', dur: 440 };
  if (aggression > 0.44 && r < 0.80) return { mv: 'scrape', dur: 520 };
  if (aggression > 0.24 && r < 0.90) return { mv: 'snort', dur: 360 };
  return { mv: 'trot', dur: 650 + Math.random() * 800 };
}

export function drawBeast(
  c: CanvasRenderingContext2D,
  env: BeastEnv,
  S: BeastState,
  d: BeastDraw,
): void {
  const { x, y, aggression: aggr, col, rgb, alpha, hot, dt, isBull } = d;
  const { frame, particles, rings, audio } = env;

  // --- advance the move clock -----------------------------------------------
  if (d.trading) {
    S.mt += dt;
    if (S.mt > S.dur) {
      S.mt = 0; S.fired = false;
      Object.assign(S, nextMove(aggr, isBull));
    }
  } else {
    S.mv = 'trot';
  }

  const k = S.dur ? Math.min(1, S.mt / S.dur) : 0;
  const swell = Math.sin(k * Math.PI);

  // --- gait ------------------------------------------------------------------
  const stride = Math.max(3, 8 - Math.floor(aggr * 5));
  const gaitPhase = (frame % (stride * 2)) / (stride * 2);
  const gait = Math.floor(frame / stride);

  const still = S.mv === 'graze';
  let sx = still ? 1 : 1 + 0.10 * Math.sin(gaitPhase * 6.283) * (0.4 + aggr);
  let sy = still ? 1 : 1 - 0.10 * Math.sin(gaitPhase * 6.283) * (0.4 + aggr);
  let dx = 0;
  let dy = still ? 0 : -Math.abs(Math.sin(gaitPhase * 3.14)) * (1.5 + aggr * 3);
  let rot = 0;

  // --- per-move displacement, particles and one-shot sound -------------------
  switch (S.mv) {
    case 'lunge':
      dx = swell * (9 + aggr * 13); sx *= 1 + swell * 0.26; sy *= 1 - swell * 0.12; rot = swell * 0.1;
      if (!S.fired && k > 0.1) { S.fired = true; if (hot) env.shake(3 + aggr * 4); }
      break;

    case 'snort':
      dx = -swell * 4;
      if (!S.fired && k > 0.25) {
        S.fired = true;
        for (let i = 0; i < 5; i++) {
          particles.push({ x: x + 14, y: y - 13, vx: 1.4 + Math.random() * 1.6, vy: (Math.random() - 0.5) * 1.1, life: 1, col: rgb, sz: 2 });
        }
        if (hot || aggr > 0.5) audio.puff(aggr);
      }
      break;

    case 'scrape':
      if (frame % 3 === 0) {
        particles.push({ x: x + 10, y: y + 1, vx: 1.6 + Math.random() * 2, vy: -Math.random() * 1.6, life: 1, col: rgb, sz: 2 });
      }
      if (!S.fired && k > 0.2) { S.fired = true; if (hot || aggr > 0.5) audio.scrape(); }
      break;

    case 'graze':
      dy = 3; rot = isBull ? 0.10 : 0.08;
      if (!S.fired && k > 0.5) {
        S.fired = true;
        if (frame % 2 === 0) particles.push({ x: x + 12, y: y + 2, vx: 0.5, vy: -0.4, life: 1, col: rgb, sz: 1 });
      }
      break;

    case 'strike':
      if (isBull) { dx = Math.abs(Math.sin(k * 6.283)) * 7; rot = -Math.abs(Math.sin(k * 6.283)) * 0.14; }
      else { dx = swell * 5; }
      if (!S.fired && k > 0.3) {
        S.fired = true;
        if (hot || aggr > 0.5) (isBull ? audio.hornSwoosh() : audio.clawSwoosh());
        if (hot) env.shake(2 + aggr * 3);
      }
      break;

    case 'bellow':
      dy -= swell * 7; rot = isBull ? -swell * 0.22 : 0; sy *= 1 + swell * 0.14;
      if (!S.fired && k > 0.12) {
        S.fired = true;
        if (hot || aggr > 0.45) (isBull ? audio.bellowBull() : audio.bellowBear());
        if (hot) env.shake(4 + aggr * 6);
        rings.push({ x, y: y + 2, r: 4, a: 0.5, col: rgb });
      }
      break;
  }

  const scale = d.base * (1 + aggr * 0.24);

  // Motion smear behind the sprite once it is moving fast.
  if (aggr > 0.62) {
    c.save();
    c.globalAlpha = alpha * (aggr - 0.62) * 0.9;
    c.translate(x + dx - 11, y + dy);
    c.scale(scale * sx, scale * sy);
    c.fillStyle = col;
    c.fillRect(-14, -13, 19, 11);
    c.restore();
  }

  // --- the sprite ------------------------------------------------------------
  c.save();
  c.globalAlpha = alpha * (hot ? 1 : 0.62);
  c.shadowColor = col;
  c.shadowBlur = (hot ? 9 + aggr * 22 : 5 + aggr * 8) * alpha;
  c.translate(x + dx, y + dy);
  c.rotate(rot);
  c.scale(sx, sy);
  if (S.mv === 'bellow' && isBull) drawBullStomp(c, 0, 0, scale, col, -1);
  else if (S.mv === 'bellow') drawBearRear(c, 0, 4, scale * 0.92, col, -1.1 + swell * 0.5);
  else if (S.mv === 'strike' && isBull) drawBullThrust(c, 0, 0, scale, col, Math.abs(Math.sin(k * 6.283)) * 6);
  else if (S.mv === 'strike') drawBearSwipe(c, 0, 0, scale, col, -0.9 + k * 2.4);
  else if (S.mv === 'scrape' && isBull) drawBullPaw(c, 0, 0, scale, col, gait);
  else if (isBull) drawBull(c, 0, 0, scale, gait, col);
  else drawBear(c, 0, 0, scale, gait, col);
  c.restore();

  // --- weapon trails ---------------------------------------------------------
  if (S.mv === 'strike') {
    const q = Math.abs(Math.sin(k * 6.283));
    if (isBull && q > 0.35) {
      c.save();
      c.globalAlpha = alpha * (q - 0.35) * 1.3;
      c.strokeStyle = col; c.lineWidth = 2;
      c.shadowColor = col; c.shadowBlur = 8;
      for (let m = 0; m < 2; m++) {
        const oy = -17 + m * 7;
        c.beginPath(); c.arc(x + dx + 13 * scale, y + dy + oy * scale, 7 + m * 3, -1.1, 1.1); c.stroke();
      }
      c.restore();
      if (frame % 2 === 0) {
        particles.push({ x: x + dx + 22 * scale, y: y + dy - 14 * scale, vx: 1.8 + Math.random() * 1.6, vy: (Math.random() - 0.5) * 1.4, life: 1, col: rgb, sz: 2 });
      }
    }
    if (!isBull && k > 0.28 && k < 0.72) {
      const a = 1 - Math.abs(k - 0.5) * 4;
      c.save();
      c.globalAlpha = alpha * Math.max(0, a) * 0.9;
      c.strokeStyle = '#FFD9CE'; c.lineWidth = 2;
      c.shadowColor = col; c.shadowBlur = 9;
      for (let m = 0; m < 3; m++) {
        const o = m * 6 - 6;
        c.beginPath();
        c.moveTo(x + dx + (9 + o * 0.3) * scale, y + dy - (20 - m * 2) * scale);
        c.lineTo(x + dx + (26 + o * 0.6) * scale, y + dy - (4 - m * 2) * scale);
        c.stroke();
      }
      c.restore();
      if (frame % 2 === 0) {
        particles.push({ x: x + dx + 20 * scale, y: y + dy - 12 * scale, vx: 1.6 + Math.random() * 1.8, vy: (Math.random() - 0.3) * 1.6, life: 1, col: rgb, sz: 2 });
      }
    }
  }

  // Eye glint. Blinks faster the more worked up the animal is.
  const glint = 0.35 + 0.65 * Math.abs(Math.sin(frame * (0.06 + aggr * 0.12)));
  c.save();
  c.globalAlpha = alpha * glint * (0.4 + aggr * 0.6);
  c.fillStyle = '#FFF6D8'; c.shadowColor = '#FFFFFF'; c.shadowBlur = 6 + aggr * 10;
  c.fillRect(x + dx + (isBull ? 9 : 8) * scale, y + dy - (isBull ? 13 : 9) * scale, 2, 2);
  c.restore();

  // Dust kicked up behind.
  if (d.trading && frame % 2 === 0 && (hot || aggr > 0.4)) {
    particles.push({ x: x - 8, y: y + 1, vx: -1.2 - Math.random() * (1 + aggr * 1.8), vy: -Math.random() * (0.8 + aggr), life: 1, col: rgb, sz: 2 });
  }
}
