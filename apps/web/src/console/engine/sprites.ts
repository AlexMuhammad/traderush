/** Pixel-art sprites, drawn as filled rectangles on the 2D context.
 *
 *  Every function draws around a local origin at the figure's FEET, so callers
 *  position by ground contact and never have to know a sprite's height. Scale is
 *  applied by the caller via `s`; the rect coordinates below are in sprite units.
 *
 *  Naming: `draw<Actor><Pose>`. The plain `drawBull` / `drawBear` are the idle and
 *  running poses; the rest are single frames of an attack or a flourish.
 */

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------- idle / run

/** `frame` alternates the leg positions; pass a counter that steps per gait tick. */
export function drawBull(c: Ctx, x: number, y: number, s: number, frame: number, col: string, tilt = 0): void {
  c.save(); c.translate(x, y); c.scale(s, s); if (tilt) c.rotate(tilt);
  c.fillStyle = col;
  const g = frame % 2;
  c.fillRect(-13, -11, 18, 9);          // body
  c.fillRect(-17, -13, 5, 5);           // rump
  c.fillRect(3, -16, 9, 8);             // head
  c.fillRect(11, -18, 3, 2); c.fillRect(11, -12, 3, 2);   // snout
  c.fillRect(2, -20, 2, 4); c.fillRect(10, -20, 2, 4);    // horns
  c.fillRect(-12, -2, 4, g ? 6 : 4);    // legs
  c.fillRect(-3, -2, 4, g ? 4 : 6);
  c.fillRect(1, -2, 3, g ? 5 : 3);
  c.fillRect(-18, -10, 3, g ? 7 : 5);   // tail
  c.restore();
}

export function drawBear(c: Ctx, x: number, y: number, s: number, frame: number, col: string, rear = 0): void {
  c.save(); c.translate(x, y); c.scale(s, s); if (rear) c.rotate(rear);
  c.fillStyle = col;
  const g = frame % 2;
  c.fillRect(-14, -12, 18, 10);         // body
  c.fillRect(-16, -15, 8, 7);           // hump
  c.fillRect(2, -13, 10, 9);            // head
  c.fillRect(10, -15, 3, 3);            // ear
  c.fillRect(11, -7, 4, 3);             // muzzle
  c.fillRect(-12, -2, 5, g ? 6 : 4);    // legs
  c.fillRect(-2, -2, 5, g ? 4 : 6);
  c.fillRect(3, -2, 4, g ? 5 : 3);
  c.restore();
}

/** You. A small glowing figure; the glow is what makes it read as the player. */
export function drawRunner(c: Ctx, x: number, y: number, rot = 0, col = '#FFD777', frame = 0): void {
  // A four-pose stride: contact, passing, contact mirrored, passing. Two poses
  // a pixel apart — which is what this was — is a shiver, not a run: the legs
  // have to leave the body and the body has to rise off them. Discrete poses
  // rather than a sine, because at eight pixels tall an interpolated limb is a
  // smear and the eye reads a run from clear contacts.
  //
  // `lift` is what sells it. Every stride the whole figure leaves the ground for
  // two frames, so it bounds instead of hovering.
  const POSE = [
    { fx: 3, fh: 5, bx: -6, bh: 3, af: 4, ab: -6, lift: 0 },
    { fx: 1, fh: 6, bx: -3, bh: 5, af: 2, ab: -4, lift: -1 },
    { fx: -5, fh: 3, bx: 2, bh: 5, af: -5, ab: 4, lift: 0 },
    { fx: -3, fh: 5, bx: 0, bh: 6, af: -4, ab: 2, lift: -1 },
  ][Math.floor(frame / 3) % 4]!;

  c.save(); c.translate(x, y); c.rotate(rot);
  c.shadowColor = 'rgba(255,215,119,.9)'; c.shadowBlur = 12;
  c.fillStyle = col;
  const L = POSE.lift;
  c.fillRect(-2, -13 + L, 6, 6);                    // head
  c.fillRect(-3, -7 + L, 8, 6);                     // torso
  // Arms swing opposite the legs — the give-away that something is running and
  // not being dragged sideways.
  c.fillRect(POSE.af, -6 + L, 3, 2);
  c.fillRect(POSE.ab, -4 + L, 3, 2);
  // Legs are anchored so a planted foot always lands on the same ground line,
  // whatever the body is doing above it.
  c.fillRect(POSE.fx, -1 + L, 3, POSE.fh);
  c.fillRect(POSE.bx, -1 + L, 3, POSE.bh);
  c.shadowBlur = 0; c.restore();
}

// ------------------------------------------------------------- bull attacks

/** Pawing the ground before a charge. */
export function drawBullPaw(c: Ctx, x: number, y: number, s: number, col: string, k: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  c.fillRect(-13, -12, 18, 9); c.fillRect(-17, -14, 5, 5);
  c.fillRect(4, -16, 9, 8);
  c.fillRect(12, -18, 3, 2); c.fillRect(12, -12, 3, 2);
  c.fillRect(3, -21, 2, 5); c.fillRect(11, -21, 2, 5);
  const swipe = k % 2 ? 5 : 1;
  c.fillRect(-1, -3, 3, 3); c.fillRect(1 + swipe, -1, 4, 2);   // scraping foreleg
  c.fillRect(-12, -3, 4, 5); c.fillRect(-4, -3, 4, 5);
  c.fillRect(-18, -11, 3, 6);
  c.restore();
}

/** Head down, horns forward. */
export function drawBullCharge(c: Ctx, x: number, y: number, s: number, col: string, k: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  c.fillRect(-14, -11, 19, 8); c.fillRect(-18, -13, 5, 5);
  c.fillRect(4, -11, 10, 8);                              // lowered head
  c.fillRect(13, -13, 6, 2); c.fillRect(13, -5, 6, 2);    // horns thrust forward
  c.fillRect(18, -14, 2, 2); c.fillRect(18, -4, 2, 2);
  const g = k % 2;
  c.fillRect(-13, -3, 4, g ? 5 : 3); c.fillRect(-5, -3, 4, g ? 3 : 5); c.fillRect(2, -3, 4, g ? 4 : 2);
  c.fillRect(-19, -12, 4, g ? 8 : 6);
  c.restore();
}

/** A horn jab thrown mid-stride. `ext` pushes the head out. */
export function drawBullThrust(c: Ctx, x: number, y: number, s: number, col: string, ext: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  c.fillRect(-13, -11, 18, 9); c.fillRect(-17, -13, 5, 5);
  c.fillRect(3 + ext, -15, 10, 8);
  c.fillRect(12 + ext, -17, 3, 2); c.fillRect(12 + ext, -11, 3, 2);
  c.fillRect(2 + ext, -20, 2, 5); c.fillRect(10 + ext, -20, 2, 5);
  c.fillRect(2 + ext, -21, 4, 2); c.fillRect(10 + ext, -21, 4, 2);  // flared tips
  c.fillRect(-12, -2, 4, 5); c.fillRect(-3, -2, 4, 5); c.fillRect(2, -2, 3, 4);
  c.fillRect(-18, -10, 3, 6);
  c.restore();
}

/** Rearing to bring the forelegs down. `raise` is how high they are. */
export function drawBullStomp(c: Ctx, x: number, y: number, s: number, col: string, raise: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  const r = Math.max(-2, raise);
  c.fillRect(-14, -13, 19, 10); c.fillRect(-18, -15, 5, 5);
  c.fillRect(5, -20, 10, 9);                              // head up
  c.fillRect(14, -22, 3, 2); c.fillRect(14, -15, 3, 2);
  c.fillRect(4, -25, 2, 5); c.fillRect(13, -25, 2, 5);
  c.fillRect(-13, -3, 4, 5); c.fillRect(-19, -14, 3, 7);
  c.fillRect(2, -4 - r, 4, 4 + Math.max(0, r));           // forelegs coming down
  c.fillRect(8, -4 - r, 4, 4 + Math.max(0, r));
  c.restore();
}

// ------------------------------------------------------------- bear attacks

/** Standing upright. `arm` is the swing angle in radians. */
export function drawBearRear(c: Ctx, x: number, y: number, s: number, col: string, arm: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  c.fillRect(-7, -3, 6, 4); c.fillRect(1, -3, 6, 4);      // hind legs
  c.fillRect(-7, -23, 14, 20);                            // upright body
  c.fillRect(-5, -34, 13, 11);                            // head
  c.fillRect(-5, -36, 3, 3); c.fillRect(5, -36, 3, 3);    // ears
  c.fillRect(7, -28, 4, 3);                               // muzzle
  c.save(); c.translate(5, -20); c.rotate(arm);
  c.fillRect(0, -4, 15, 7);
  c.fillRect(15, -6, 3, 3); c.fillRect(15, -1, 3, 3); c.fillRect(15, 3, 3, 3);  // claws
  c.restore(); c.restore();
}

/** Jaws. `gap` opens them; 0 is closed. */
export function drawBearBite(c: Ctx, x: number, y: number, s: number, col: string, gap: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  c.fillRect(-16, -13, 20, 11); c.fillRect(-18, -17, 9, 8);
  c.fillRect(-13, -2, 5, 6); c.fillRect(-3, -2, 5, 6);
  c.fillRect(2, -16, 11, 7); c.fillRect(11, -18, 3, 3);
  c.fillRect(13, -14 - gap, 6, 3);                        // upper jaw
  c.fillRect(13, -7 + gap, 6, 3);                         // lower jaw
  c.fillRect(19, -13 - gap, 2, 2); c.fillRect(19, -6 + gap, 2, 2);  // fangs
  c.restore();
}

/** A claw swipe thrown mid-stride. */
export function drawBearSwipe(c: Ctx, x: number, y: number, s: number, col: string, arm: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  c.fillRect(-14, -12, 18, 10); c.fillRect(-16, -15, 8, 7);
  c.fillRect(2, -15, 10, 9); c.fillRect(10, -17, 3, 3); c.fillRect(11, -9, 4, 3);
  c.fillRect(-12, -2, 5, 5); c.fillRect(-2, -2, 5, 5);
  c.save(); c.translate(7, -12); c.rotate(arm);
  c.fillRect(0, -3, 12, 6);
  c.fillRect(12, -5, 3, 3); c.fillRect(12, -1, 3, 3); c.fillRect(12, 3, 3, 3);
  c.restore(); c.restore();
}

/** Both arms overhead, coming down. `armY` slides them. */
export function drawBearSlam(c: Ctx, x: number, y: number, s: number, col: string, armY: number): void {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col;
  c.fillRect(-8, -3, 6, 4); c.fillRect(2, -3, 6, 4);
  c.fillRect(-8, -24, 15, 21);
  c.fillRect(-6, -35, 13, 11);
  c.fillRect(-6, -37, 3, 3); c.fillRect(4, -37, 3, 3);
  c.fillRect(6, -29, 4, 3);
  c.fillRect(6, -26 + armY, 7, 16); c.fillRect(11, -26 + armY, 7, 16);
  for (let i = 0; i < 3; i++) {
    c.fillRect(13, -11 + armY + i * 5, 4, 3);
    c.fillRect(17, -11 + armY + i * 5, 3, 3);
  }
  c.restore();
}

// ------------------------------------------------------------ runner states

/** Struck: limbs thrown outward. */
export function drawRunnerHit(c: Ctx, x: number, y: number, rot = 0, col = '#FFD777'): void {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.shadowColor = 'rgba(255,255,255,.9)'; c.shadowBlur = 14;
  c.fillStyle = col;
  c.fillRect(-2, -14, 6, 6); c.fillRect(-3, -8, 8, 6);
  c.fillRect(-11, -9, 8, 3); c.fillRect(5, -12, 8, 3);    // arms flung
  c.fillRect(-8, -2, 7, 3); c.fillRect(3, -2, 7, 3);      // legs splayed
  c.shadowBlur = 0; c.restore();
}

/** Down. No glow — that is the point. */
export function drawRunnerLimp(c: Ctx, x: number, y: number, col = '#C9A45E'): void {
  c.save(); c.translate(x, y); c.fillStyle = col;
  c.fillRect(-12, -5, 8, 6); c.fillRect(-4, -4, 10, 5);
  c.fillRect(6, -3, 6, 3); c.fillRect(-2, -8, 5, 3);
  c.restore();
}

/** Planted, taking the charge. `k` ramps the glow as the impact nears. */
export function drawRunnerBrace(c: Ctx, x: number, y: number, k: number): void {
  c.save(); c.translate(x, y);
  c.shadowColor = 'rgba(255,215,119,.95)'; c.shadowBlur = 10 + k * 12;
  c.fillStyle = '#FFD777';
  c.fillRect(-3, -14, 6, 6); c.fillRect(-4, -8, 8, 7);
  c.fillRect(-11, -8, 7, 3);                              // arm braced into it
  c.fillRect(-8, -1, 6, 3); c.fillRect(2, -1, 6, 3);      // wide stance
  c.shadowBlur = 0; c.restore();
}

/** Victory: both arms up, lifting off the ground as `k` rises. */
export function drawRunnerPose(c: Ctx, x: number, y: number, k: number): void {
  c.save(); c.translate(x, y);
  c.shadowColor = 'rgba(255,215,119,1)'; c.shadowBlur = 14 + k * 14;
  c.fillStyle = '#FFE9A8';
  const lift = k * 3;
  c.fillRect(-3, -16 - lift, 6, 6); c.fillRect(-4, -10 - lift, 8, 7);
  c.fillRect(-10, -18 - lift, 4, 9); c.fillRect(6, -18 - lift, 4, 9);
  c.fillRect(-4, -3, 3, 4); c.fillRect(1, -3, 3, 4);
  c.shadowBlur = 0; c.restore();
}
