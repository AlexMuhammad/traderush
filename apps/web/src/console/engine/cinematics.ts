import type { Attack, Particle } from './types';
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
