/** Every sound the console makes.
 *
 *  One AudioContext, created on the first real gesture — browsers refuse to start
 *  one before that. Two oscillators run continuously and are only modulated: a
 *  low `drone` for tension, and a `growl` that fades in when you are being chased.
 *  Everything else is a one-shot.
 */

type Wave = OscillatorType;

export class Audio {
  private ac: AudioContext | null = null;
  private drone: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private growl: OscillatorNode | null = null;
  private growlGain: GainNode | null = null;

  get started(): boolean { return this.ac !== null; }

  /** Idempotent. Call from a pointer handler, never on load. */
  start(): void {
    if (this.ac) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ac = new Ctor();
    this.ac = ac;

    this.drone = ac.createOscillator();
    this.droneGain = ac.createGain();
    const lp = ac.createBiquadFilter();
    this.drone.type = 'sawtooth';
    this.drone.frequency.value = 55;
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    this.droneGain.gain.value = 0.014;
    this.drone.connect(lp); lp.connect(this.droneGain); this.droneGain.connect(ac.destination);
    this.drone.start();

    this.growl = ac.createOscillator();
    this.growlGain = ac.createGain();
    const gf = ac.createBiquadFilter();
    this.growl.type = 'sawtooth';
    this.growl.frequency.value = 42;
    gf.type = 'lowpass';
    gf.frequency.value = 170;
    this.growlGain.gain.value = 0;
    this.growl.connect(gf); gf.connect(this.growlGain); this.growlGain.connect(ac.destination);
    this.growl.start();
  }

  /** The continuous bed. `urgency` rises near expiry, `threat` while chased. */
  setBed(trading: boolean, urgency: number, threat: number): void {
    if (!this.ac || !this.droneGain || !this.drone) return;
    this.droneGain.gain.value = trading ? 0.012 + urgency * 0.028 + threat * 0.022 : 0.008;
    this.drone.frequency.value = 55 + urgency * 36 + threat * 24;
  }

  setGrowl(level: number): void {
    if (this.growlGain) this.growlGain.gain.value = Math.max(0, level);
  }

  // ---------------------------------------------------------------- primitives

  tone(freq: number, dur: number, type: Wave = 'sine', gain = 0.12, slideTo?: number): void {
    const ac = this.ac; if (!ac) return;
    const o = ac.createOscillator(), v = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    o.connect(v); v.connect(ac.destination);
    v.gain.setValueAtTime(gain, ac.currentTime);
    v.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
    o.start(); o.stop(ac.currentTime + dur);
  }

  /** Decaying white noise through a lowpass — every impact and scrape is this. */
  noise(dur: number, gain: number, cutoff = 900): void {
    const ac = this.ac; if (!ac) return;
    const n = ac.sampleRate * dur;
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(), v = ac.createGain(), lp = ac.createBiquadFilter();
    src.buffer = buf;
    lp.type = 'lowpass'; lp.frequency.value = cutoff;
    v.gain.value = gain;
    src.connect(lp); lp.connect(v); v.connect(ac.destination);
    src.start();
  }

  private burst(delays: number[], fn: () => void): void {
    for (const d of delays) setTimeout(fn, d);
  }

  // ------------------------------------------------------------------- console

  keyDown() { this.tone(2100, 0.02, 'square', 0.07); }
  keyUp() { this.tone(1500, 0.015, 'square', 0.04); }
  reject() { this.tone(150, 0.14, 'square', 0.09); }
  countdown() { this.tone(1300, 0.07, 'square', 0.1); }
  tuneClick() { this.tone(880, 0.08, 'square', 0.05); }

  // -------------------------------------------------------------------- beasts

  /** Footfall. `intensity` 0..1 tracks how hard you are being hunted. */
  hoof(intensity: number) {
    this.noise(0.07, 0.08 + intensity * 0.32, 150 + intensity * 190);
    this.tone(70, 0.09, 'sine', 0.05 + intensity * 0.14, 48);
  }
  snort() { this.noise(0.16, 0.16, 420); this.tone(120, 0.2, 'sawtooth', 0.09, 70); }
  puff(i: number) { this.noise(0.1, 0.06 + i * 0.1, 700); this.tone(150, 0.12, 'sawtooth', 0.03 + i * 0.05, 95); }
  scrape() { this.noise(0.13, 0.16, 900); }
  hornSwoosh() { this.noise(0.11, 0.2, 1500); this.tone(300, 0.13, 'sawtooth', 0.09, 140); }
  clawSwoosh() { this.burst([0, 60], () => this.noise(0.08, 0.26, 2600)); }
  bellowBull() {
    this.tone(150, 0.5, 'sawtooth', 0.13, 88);
    setTimeout(() => this.tone(110, 0.4, 'sawtooth', 0.09, 70), 120);
  }
  bellowBear() { this.tone(105, 0.62, 'sawtooth', 0.15, 52); this.noise(0.4, 0.16, 260); }

  // ------------------------------------------------------------- border & bets

  cross() { this.noise(0.3, 0.34, 700); this.tone(320, 0.35, 'sawtooth', 0.15, 110); }
  recross() { this.tone(880, 0.25, 'triangle', 0.11, 1320); }
  board(side: 'up' | 'down') {
    this.tone(side === 'up' ? 520 : 330, 0.22, 'triangle', 0.13, side === 'up' ? 880 : 220);
  }
  bail() { this.tone(660, 0.18, 'triangle', 0.1, 440); }
  horn() {
    this.tone(240, 0.5, 'sawtooth', 0.12, 180);
    setTimeout(() => this.tone(180, 0.7, 'sawtooth', 0.1, 120), 140);
  }

  // ---------------------------------------------------------- kill sequences

  paw() {
    this.burst([0, 150, 300], () => this.noise(0.13, 0.2, 520));
    setTimeout(() => this.tone(115, 0.3, 'sawtooth', 0.11, 72), 60);
  }
  charge() { this.noise(0.42, 0.3, 340); this.tone(85, 0.45, 'sawtooth', 0.15, 150); }
  gore() { this.noise(0.16, 0.7, 1600); this.tone(300, 0.13, 'square', 0.22, 80); }
  stomp() {
    this.noise(0.5, 0.7, 200); this.tone(64, 0.75, 'sine', 0.28, 38);
    setTimeout(() => this.noise(0.25, 0.3, 600), 40);
  }
  rear() { this.tone(130, 0.55, 'sawtooth', 0.15, 58); this.noise(0.3, 0.2, 300); }
  claw() {
    this.burst([0, 85, 175], () => this.noise(0.1, 0.42, 2400));
    setTimeout(() => { this.tone(160, 0.7, 'sawtooth', 0.16, 48); this.noise(0.5, 0.3, 300); }, 210);
  }
  chomp() {
    this.noise(0.09, 0.55, 2600); this.tone(420, 0.1, 'square', 0.2, 110);
    setTimeout(() => this.noise(0.07, 0.35, 1800), 70);
  }
  shakePrey() {
    this.burst([0, 80, 160, 240], () => {
      this.noise(0.07, 0.22, 900); this.tone(190, 0.09, 'sawtooth', 0.09, 120);
    });
  }
  slam() {
    this.burst([0, 110], () => { this.noise(0.35, 0.6, 240); this.tone(72, 0.55, 'sine', 0.24, 40); });
  }

  // ----------------------------------------------------------- win sequences

  brace() { this.noise(0.2, 0.28, 320); this.tone(150, 0.35, 'sine', 0.13, 90); }
  clash() { this.noise(0.14, 0.75, 2200); this.tone(520, 0.16, 'square', 0.22, 150); }
  repel() { this.noise(0.55, 0.4, 3000); this.tone(180, 0.7, 'sine', 0.16, 900); }
  chord() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 1.5, 'triangle', 0.11), i * 70));
  }
  escape() {
    [784, 988, 1319, 1568].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.14), i * 90));
  }
}
