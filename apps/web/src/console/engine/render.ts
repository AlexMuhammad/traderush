import type { Audio } from './audio';
import type { BeastState } from './beasts';
import { drawBeast } from './beasts';
import { drawCinematic } from './cinematics';
import { burst, stepParticles, stepRings, stepSlashes } from './fx';
import { drawRunner } from './sprites';
import type { Attack, Outcome, Particle, Race, Ring, Slash } from './types';

/** The scene renderer. One function, called once per animation frame.
 *
 *  Reading order matches painting order: territories, grid, the strike line,
 *  the price trail, the animals, the player, then the overlays. Everything it
 *  needs is on `S` — it owns no state of its own.
 */

/** What the renderer reads and writes on the engine. */
export interface Scene {
  race: Race;
  frame: number;
  speed: number;
  audio: Audio;

  particles: Particle[];
  rings: Ring[];
  slashes: Slash[];
  attack: Attack | null;
  outcome: Outcome | null;

  /** Screen shake, decays each frame. */
  shake: number;
  /** Full-canvas colour flash, decays each frame. */
  flash: number;
  flashCol: string;

  /** Smoothed animal positions, so they glide rather than snap. */
  bullX: number; bullY: number; bearX: number; bearY: number;
  /** Fade for each animal. The ally fades out once a side is chosen. */
  bullA: number; bearA: number;
  beasts: { bull: BeastState; bear: BeastState };

  /** Timers driving the idle behaviours. */
  hoofT: number; lungeT: number; lunge: number; borderT: number;

  /** Which way the price is going, held across flat samples so the arrow above
   *  the runner does not flicker. */
  rising: boolean;

  /** Set by the renderer, read by the chrome. */
  phaseName: string;
  chased: boolean;
}

const BULL_RGB = '63,217,139';
const BEAR_RGB = '255,90,72';

/** Aggression curve across the window. Four bands rather than a smooth ramp:
 *  the animals should be visibly calm for over half the window so the endgame
 *  reads as an escalation and not as constant noise. */
function aggressionFor(progress: number): { base: number; name: string } {
  if (progress < 0.55) return { base: 0.04, name: 'GRAZING' };
  if (progress < 0.80) return { base: 0.06 + (progress - 0.55) / 0.25 * 0.26, name: 'STIRRING' };
  if (progress < 0.94) return { base: 0.32 + (progress - 0.80) / 0.14 * 0.30, name: 'HUNTING' };
  return { base: 0.62 + (progress - 0.94) / 0.06 * 0.38, name: 'FINAL FURLONG' };
}

export function renderScene(c: CanvasRenderingContext2D, S: Scene, dt: number, dpr: number): void {
  const canvas = c.canvas;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const R = S.race;

  const progress = Math.min(1, R.t / R.win);
  const urgency = R.phase === 'trade' ? Math.max(0, (progress - 0.90) / 0.10) : 0;
  const { base: baseAggr, name: phaseName } = aggressionFor(progress);
  S.phaseName = phaseName;

  const bullish = R.spot >= R.strike;
  const trailRGB = bullish ? BULL_RGB : BEAR_RGB;
  const trailCol = bullish ? '#3FD98B' : '#FF5A48';

  const myOdds = R.pos ? (R.pos.side === 'up' ? R.upP : 1 - R.upP) : null;
  const threat = myOdds === null ? 0.4 : 1 - myOdds;
  const inDanger = R.pos ? (R.pos.side === 'up' ? !bullish : bullish) : false;
  S.chased = inDanger;

  // ---- shake is applied as a transform, so nothing else has to know about it
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (S.shake > 0) {
    c.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
    S.shake *= 0.88;
    if (S.shake < 0.3) S.shake = 0;
  }
  c.fillStyle = '#000';
  c.fillRect(-12, -12, w + 24, h + 24);

  if (R.hist.length > 1) {
    // ---- vertical scale: fit the trail and the strike, with generous padding
    const lo = Math.min(R.strike, ...R.hist);
    const hi = Math.max(R.strike, ...R.hist);
    const pad = (hi - lo) * 0.75 + 22;
    const mn = lo - pad, mx = hi + pad;
    const Y = (p: number) => h - 12 - ((p - mn) / (mx - mn)) * (h - 26);

    const nowX = Math.round(30 + (w - 46) * progress);
    const N = R.hist.length;
    const step = Math.max(0.5, (nowX - 8) / Math.max(1, N - 1));
    const ly = Math.round(Y(R.strike)) + 0.5;   // the border between territories

    // ---- territories -------------------------------------------------------
    // The hunter is whichever animal owns the half you are NOT on.
    const bullHot = Boolean(R.pos && R.pos.side === 'down' && inDanger);
    const bearHot = Boolean(R.pos && R.pos.side === 'up' && inDanger);
    // Before you pick a side both animals are present; after, only your hunter.
    const wantBull = !R.pos || R.pos.side === 'down';
    const wantBear = !R.pos || R.pos.side === 'up';
    S.bullA += ((wantBull ? 1 : 0) - S.bullA) * 0.10;
    S.bearA += ((wantBear ? 1 : 0) - S.bearA) * 0.10;

    c.fillStyle = `rgba(63,217,139,${bullHot ? 0.13 : 0.05})`;
    c.fillRect(0, 0, w, ly);
    c.fillStyle = `rgba(255,90,72,${bearHot ? 0.13 : 0.05})`;
    c.fillRect(0, ly, w, h - ly);
    c.font = '700 9px Barlow Condensed, sans-serif';
    c.fillStyle = 'rgba(63,217,139,.42)'; c.fillText('BULL TERRITORY', 5, 12);
    c.fillStyle = 'rgba(255,90,72,.42)'; c.fillText('BEAR TERRITORY', 5, h - 5);

    // Scrolling grid, and the ticks at the right edge.
    c.fillStyle = 'rgba(255,255,255,.026)';
    for (let x = (-S.frame * 1.1) % 46; x < w; x += 46) c.fillRect(Math.round(x), 0, 1, h);
    c.fillStyle = 'rgba(255,255,255,.4)';
    for (let y = 0; y < h; y += 8) c.fillRect(w - 3, y, 3, 4);

    // ---- the strike line ---------------------------------------------------
    const pulse = 0.4 + 0.4 * urgency * (0.5 + 0.5 * Math.sin(S.frame * 0.25));
    c.strokeStyle = `rgba(255,200,87,${pulse.toFixed(3)})`;
    c.lineWidth = 1.5;
    c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(0, ly); c.lineTo(w, ly); c.stroke();
    c.setLineDash([]);

    c.font = '400 9px Share Tech Mono, monospace';
    const strikeLabel = 'STRIKE ' + R.strike.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    c.fillStyle = 'rgba(0,0,0,.55)';
    c.fillRect(3, ly - 13, c.measureText(strikeLabel).width + 6, 11);
    c.fillStyle = 'rgba(255,200,87,.9)';
    c.fillText(strikeLabel, 6, ly - 5);

    // ---- the live price, floating above the runner's head ------------------
    const spotLabel = R.spot.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    const ARROW_W = 9;
    const tagW = c.measureText(spotLabel).width + 8 + ARROW_W;
    const headY = Y(R.hist[N - 1]!);
    const tagX = Math.max(2, Math.min(w - tagW - 2, nowX - tagW / 2));
    const tagY = Math.max(10, headY - 24);
    c.fillStyle = 'rgba(0,0,0,.6)';
    c.fillRect(tagX, tagY, tagW, 11);
    c.fillStyle = 'rgba(255,255,255,.98)';
    c.fillText(spotLabel, tagX + 4, tagY + 8);

    // Which way the last few samples went. Compared over several rather than
    // the last pair: a single tick flickers, and an arrow that flickers reads
    // as noise instead of direction. Holds its last direction when flat.
    const back = R.hist[Math.max(0, N - 4)]!;
    const latest = R.hist[N - 1]!;
    if (latest !== back) S.rising = latest > back;
    const arrowX = tagX + tagW - ARROW_W - 1;
    const arrowY = tagY + 5.5;
    c.fillStyle = S.rising ? '#3FD98B' : '#FF5A48';
    c.beginPath();
    if (S.rising) {
      c.moveTo(arrowX + 3.5, arrowY - 3.5);
      c.lineTo(arrowX + 7, arrowY + 2.5);
      c.lineTo(arrowX, arrowY + 2.5);
    } else {
      c.moveTo(arrowX + 3.5, arrowY + 3.5);
      c.lineTo(arrowX, arrowY - 2.5);
      c.lineTo(arrowX + 7, arrowY - 2.5);
    }
    c.closePath();
    c.fill();

    // ---- the trail ---------------------------------------------------------
    c.beginPath();
    c.moveTo(8, h);
    for (let i = 0; i < N; i++) c.lineTo(8 + i * step, Y(R.hist[i]!));
    c.lineTo(nowX, h);
    c.closePath();
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${trailRGB},.24)`);
    grad.addColorStop(1, `rgba(${trailRGB},.02)`);
    c.fillStyle = grad;
    c.fill();

    c.shadowColor = `rgba(${trailRGB},.9)`;
    c.shadowBlur = 9 + 8 * urgency;
    c.strokeStyle = trailCol; c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < N; i++) {
      const x = 8 + i * step;
      i ? c.lineTo(x, Y(R.hist[i]!)) : c.moveTo(x, Y(R.hist[i]!));
    }
    c.stroke();
    c.shadowBlur = 0;

    const runnerY = Y(R.hist[N - 1]!);
    const slope = N > 3 ? Y(R.hist[N - 1]!) - Y(R.hist[N - 4]!) : 0;

    // ---- border crossing ---------------------------------------------------
    if (R.phase === 'trade' && R.pos && inDanger !== R.wasDanger) {
      R.wasDanger = inDanger;
      if (inDanger) {
        S.audio.cross(); S.shake = 10; S.flash = 0.5; S.flashCol = BEAR_RGB;
        burst(S.particles, nowX, ly, 18, '255,200,87', 7);
      } else {
        S.audio.recross();
        burst(S.particles, nowX, ly, 12, '255,200,87', 5);
      }
    }

    // ---- animal placement --------------------------------------------------
    // The invariant that makes the whole thing legible: a bull never appears
    // below the line, a bear never above it. They cannot cross; you can.
    if (R.phase === 'trade' && threat > 0.68 && inDanger) {
      S.lungeT += dt;
      if (S.lungeT > 1400) { S.lungeT = 0; S.lunge = 1; S.audio.snort(); }
    }
    S.lunge *= 0.93;
    const gapPx = 9 + (1 - threat) * 32 - S.lunge * 7;

    let bullTargetX: number, bullTargetY: number, bullScale = 0.85;
    if (bullHot) {
      bullTargetX = nowX - gapPx;
      bullTargetY = Math.min(ly - 4, runnerY);
      bullScale = 0.85 + threat * 0.35;
    } else if (!wantBull) {
      bullTargetX = -70; bullTargetY = S.bullY; bullScale = 0.78;
    } else {
      bullTargetX = nowX - 52 + Math.sin(S.frame * 0.03) * 10;
      bullTargetY = ly - 16; bullScale = 0.78;
    }
    S.bullX += (bullTargetX - S.bullX) * (S.bullX ? 0.2 : 1);
    S.bullY += (bullTargetY - S.bullY) * (S.bullY ? 0.16 : 1);
    S.bullY = Math.min(S.bullY, ly - 4);

    let bearTargetX: number, bearTargetY: number, bearScale = 0.85;
    if (bearHot) {
      bearTargetX = nowX - gapPx;
      bearTargetY = Math.max(ly + 4, runnerY);
      bearScale = 0.85 + threat * 0.35;
    } else if (!wantBear) {
      bearTargetX = -70; bearTargetY = S.bearY; bearScale = 0.78;
    } else {
      bearTargetX = nowX - 52 + Math.sin(S.frame * 0.028 + 2) * 10;
      bearTargetY = ly + 22; bearScale = 0.78;
    }
    S.bearX += (bearTargetX - S.bearX) * (S.bearX ? 0.2 : 1);
    S.bearY += (bearTargetY - S.bearY) * (S.bearY ? 0.16 : 1);
    S.bearY = Math.max(S.bearY, ly + 16);

    // The hunter swipes at the border when you skirt it from the safe side.
    if (R.phase === 'trade' && R.pos && !inDanger && Math.abs(runnerY - ly) < 20) {
      S.borderT += dt;
      if (S.borderT > 420) {
        S.borderT = 0;
        burst(S.particles, nowX - 14, ly, 4, R.pos.side === 'up' ? '255,150,130' : '120,230,170', 4);
        S.audio.noise(0.06, 0.12, 1600);
      }
    }

    // ---- actors ------------------------------------------------------------
    if (S.attack) {
      S.attack.t += dt;
      const want = drawCinematic(c, S.attack, { frame: S.frame, particles: S.particles, w, h });
      if (want > S.shake) S.shake = want;
    } else {
      const bullAggr = bullHot ? Math.min(1, baseAggr + threat * 0.45) : Math.min(0.42, baseAggr * 0.8);
      const bearAggr = bearHot ? Math.min(1, baseAggr + threat * 0.45) : Math.min(0.42, baseAggr * 0.8);
      const env = {
        frame: S.frame, particles: S.particles, rings: S.rings, audio: S.audio,
        shake: (n: number) => { if (n > S.shake) S.shake = n; },
      };

      if (S.bullA > 0.02) {
        drawBeast(c, env, S.beasts.bull, {
          x: S.bullX, y: S.bullY, base: bullScale, aggression: bullAggr,
          col: '#5BF0A6', rgb: '91,240,166', alpha: S.bullA, hot: bullHot,
          dt, isBull: true, trading: R.phase === 'trade',
        });
      }
      if (S.bearA > 0.02) {
        drawBeast(c, env, S.beasts.bear, {
          x: S.bearX, y: S.bearY, base: bearScale, aggression: bearAggr,
          col: '#FF7566', rgb: '255,150,130', alpha: S.bearA, hot: bearHot,
          dt, isBull: false, trading: R.phase === 'trade',
        });
      }

      const bob = (R.phase === 'trade' && Math.floor(S.frame / 4) % 2) ? -2 : 0;
      const lean = Math.max(-0.4, Math.min(0.4, slope * 0.05)) + (inDanger ? threat * 0.3 : 0);
      drawRunner(c, nowX, runnerY + bob, lean, '#FFD777', S.frame);
      if (R.phase === 'trade' && S.frame % 3 === 0) {
        S.particles.push({ x: nowX - 4, y: runnerY + 2, vx: -1.5 - Math.random(), vy: -Math.random() * 0.6, life: 1, col: '255,190,110', sz: 2 });
      }

      // Sight lines from the hunter to you, once it has locked on.
      if (inDanger && threat > 0.68 && R.phase === 'trade') {
        const hx = bullHot ? S.bullX : S.bearX;
        const hy = bullHot ? S.bullY : S.bearY;
        c.strokeStyle = `rgba(${bullHot ? '91,240,166' : '255,117,102'},${((threat - 0.68) * 3).toFixed(2)})`;
        c.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.moveTo(hx + 13, hy - 14 + i * 4);
          c.lineTo(nowX - 5, runnerY - 9 + i * 4);
          c.stroke();
        }
      }
    }

    // ---- footfalls and the growl ------------------------------------------
    if (R.phase === 'trade' && S.audio.started) {
      S.hoofT += dt;
      const period = inDanger ? 520 - threat * 360 : 640;
      if (S.hoofT > period) {
        S.hoofT = 0;
        S.audio.hoof(inDanger ? threat : 0.15);
        if (inDanger && threat > 0.8 && S.shake < 1.8) S.shake = 1.8;
      }
    }
    S.audio.setGrowl(R.phase === 'trade' && inDanger ? Math.max(0, threat - 0.45) * 0.11 : 0);

    // ---- the last five seconds, as a giant numeral -------------------------
    if (R.phase === 'trade' && R.win - R.t <= 5) {
      const n = R.win - R.t;
      const pp = 1 - ((Date.now() / 1000) % 1);
      c.globalAlpha = 0.11 + 0.19 * pp;
      c.fillStyle = '#FFC857';
      c.font = `700 ${(70 + pp * 22).toFixed(0)}px Barlow Condensed, sans-serif`;
      c.textAlign = 'center';
      c.fillText(String(n), w / 2, h / 2 + 24);
      c.globalAlpha = 1;
      c.textAlign = 'left';
    }
  }

  stepRings(c, S.rings);
  stepSlashes(c, S.slashes, dt);
  stepParticles(c, S.particles);

  // ---- result card ---------------------------------------------------------
  if (S.outcome) {
    c.fillStyle = 'rgba(0,0,0,.5)';
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.shadowColor = S.outcome.win ? 'rgba(63,217,139,.9)' : 'rgba(255,90,72,.9)';
    c.shadowBlur = 22;
    c.fillStyle = S.outcome.win ? '#5BF0A6' : '#FF7566';
    c.font = '700 36px Barlow Condensed, sans-serif';
    c.fillText(S.outcome.txt, w / 2, h / 2 + 2);
    c.shadowBlur = 0;
    c.font = '400 14px Share Tech Mono, monospace';
    c.fillStyle = S.outcome.win ? 'rgba(91,240,166,.9)' : 'rgba(255,117,102,.9)';
    c.fillText(S.outcome.sub, w / 2, h / 2 + 24);
    c.textAlign = 'left';
  }

  // ---- how the pack is split, along the bottom edge ------------------------
  {
    const barH = 11, barY = h - barH;
    c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, barY, w, barH);
    const upW = Math.round(w * R.upP);
    c.fillStyle = 'rgba(63,217,139,.85)'; c.fillRect(0, barY, upW, barH);
    c.fillStyle = 'rgba(255,90,72,.85)'; c.fillRect(upW, barY, w - upW, barH);
    c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(0, barY, w, 1);
    c.font = '500 9px Share Tech Mono, monospace';
    const up = Math.round(R.upP * 100);
    c.fillStyle = '#04301B'; c.fillText(`${up}%`, 4, barY + 8);
    const down = `${100 - up}%`;
    c.fillStyle = '#3F0A04'; c.fillText(down, w - 4 - c.measureText(down).width, barY + 8);
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(upW - 1, barY, 2, barH);
  }

  // ---- form guide: the last six results, top right ------------------------
  R.settled.slice(-6).forEach((r, i) => {
    c.fillStyle = r.w === 'up' ? 'rgba(63,217,139,.75)' : 'rgba(255,90,72,.75)';
    c.fillRect(w - 6 - (6 - i) * 8, 6, 6, 6);
  });

  // ---- flash and vignette --------------------------------------------------
  if (S.flash > 0) {
    c.fillStyle = `rgba(${S.flashCol},${(S.flash * 0.6).toFixed(3)})`;
    c.fillRect(-12, -12, w + 24, h + 24);
    S.flash *= 0.86;
    if (S.flash < 0.02) S.flash = 0;
  }

  const vig = Math.max(urgency * 0.3, R.pos && inDanger ? Math.max(0, threat - 0.45) * 0.85 : 0);
  if (vig > 0.02) {
    const v = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(255,30,0,${vig.toFixed(3)})`);
    c.fillStyle = v;
    c.fillRect(0, 0, w, h);
  }

  S.audio.setBed(R.phase === 'trade', urgency, R.pos && inDanger ? threat : 0);
  S.frame++;
}
