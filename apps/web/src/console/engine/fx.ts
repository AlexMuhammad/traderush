import type { Particle, Ring, Slash } from './types';

/** Screen effects: particles, shockwave rings, claw slashes.
 *  All are plain arrays advanced once per frame and drawn in one pass. */

export function burst(out: Particle[], x: number, y: number, n: number, col: string, power: number): void {
  for (let i = 0; i < n; i++) {
    out.push({
      x, y,
      vx: (Math.random() - 0.5) * power,
      vy: (Math.random() - 0.85) * power,
      life: 1, col,
      sz: Math.random() < 0.3 ? 3 : 2,
    });
  }
}

export function stepParticles(c: CanvasRenderingContext2D, parts: Particle[]): void {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    p.x += p.vx; p.y += p.vy; p.vy += 0.11; p.life -= 0.028;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    c.globalAlpha = p.life * 0.9;
    c.fillStyle = `rgb(${p.col})`;
    c.fillRect(p.x, p.y, p.sz, p.sz);
  }
  c.globalAlpha = 1;
}

/** Flattened ellipses, so a bellow reads as a wave across the ground. */
export function stepRings(c: CanvasRenderingContext2D, rings: Ring[]): void {
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i]!;
    g.r += 2.6; g.a *= 0.93;
    if (g.a < 0.02) { rings.splice(i, 1); continue; }
    c.save();
    c.globalAlpha = g.a;
    c.strokeStyle = `rgb(${g.col})`;
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(g.x, g.y, g.r, g.r * 0.32, 0, 0, 7);
    c.stroke();
    c.restore();
  }
}

export function stepSlashes(c: CanvasRenderingContext2D, slashes: Slash[], dt: number): void {
  for (let i = slashes.length - 1; i >= 0; i--) {
    const s = slashes[i]!;
    s.t += dt;
    const p = Math.min(1, s.t / 380);
    if (p >= 1) { slashes.splice(i, 1); continue; }
    c.save();
    c.globalAlpha = (1 - p) * 0.95;
    c.strokeStyle = '#FFD9CE';
    c.lineWidth = 3 - p * 2;
    c.shadowColor = 'rgba(255,90,72,.9)';
    c.shadowBlur = 12;
    for (let k = 0; k < 3; k++) {
      const o = k * 11 - 11;
      c.beginPath();
      c.moveTo(s.x + 40 + o, s.y - 40);
      c.lineTo(s.x - 40 + o + p * 30, s.y + 40);
      c.stroke();
    }
    c.restore();
  }
}
