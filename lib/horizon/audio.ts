// Звук «Horizon Aktobe» без файлов: мотор, ветер и удары синтезируются
// через WebAudio. Контекст создаётся только по нажатию (так требует iOS).

export class HorizonAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private muted = false;
  private running = false;

  get started(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return;

    const ctx = new Ctor();
    this.ctx = ctx;
    await ctx.resume().catch(() => undefined);

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.75;
    master.connect(ctx.destination);
    this.master = master;

    // Мотор: два пилообразных тона + суб-бас через низкий фильтр.
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0001;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 5;
    engineGain.connect(filter);
    filter.connect(master);

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 60;
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 90;
    const oscSub = ctx.createOscillator();
    oscSub.type = 'sine';
    oscSub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    oscA.connect(engineGain);
    oscB.connect(engineGain);
    oscSub.connect(subGain);
    subGain.connect(engineGain);
    oscA.start();
    oscB.start();
    oscSub.start();
    this.engineGain = engineGain;
    this.engineFilter = filter;
    this.oscA = oscA;
    this.oscB = oscB;
    this.oscSub = oscSub;

    // Ветер: белый шум через полосовой фильтр.
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.0001;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.7;
    noise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    noise.start();
    this.noise = noise;
    this.windGain = windGain;
    this.windFilter = windFilter;
    this.running = true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.75, this.ctx.currentTime, 0.05);
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Обновление параметров мотора и ветра — каждый кадр. */
  update(params: { rpm: number; speed: number; throttle: number; nitro: boolean; active: boolean; airborne: boolean }): void {
    if (!this.ctx || !this.running) return;
    const { rpm, speed, throttle, nitro, active, airborne } = params;
    const t = this.ctx.currentTime;
    const target = !active ? 0.0001 : airborne ? 0.03 : 0.06 + throttle * 0.1 + Math.min(0.05, Math.abs(speed) * 0.0009);
    this.engineGain?.gain.setTargetAtTime(target, t, 0.08);

    const base = 48 + rpm * 150 + Math.min(40, Math.abs(speed) * 0.9) + (nitro ? 22 : 0);
    this.oscA?.frequency.setTargetAtTime(base, t, 0.05);
    this.oscB?.frequency.setTargetAtTime(base * 1.51, t, 0.05);
    this.oscSub?.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    this.engineFilter?.frequency.setTargetAtTime(600 + rpm * 2200 + (nitro ? 900 : 0), t, 0.1);

    const windTarget = !active ? 0.0001 : 0.008 + Math.min(0.11, (Math.abs(speed) / 60) * 0.11);
    this.windGain?.gain.setTargetAtTime(windTarget, t, 0.15);
    this.windFilter?.frequency.setTargetAtTime(420 + Math.abs(speed) * 14, t, 0.15);
  }

  bang(strength: number): void {
    this.burst(0.16, 420, 0.5 + strength * 0.6, 'lowpass');
  }

  land(strength: number): void {
    this.burst(0.1, 160, 0.4 + strength, 'lowpass');
  }

  ui(kind: 'tick' | 'go' | 'finish' | 'click'): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = kind === 'click' ? 'triangle' : 'sine';
    const freq = kind === 'tick' ? 520 : kind === 'go' ? 880 : kind === 'finish' ? 1046 : 660;
    osc.frequency.setValueAtTime(freq, t);
    if (kind === 'finish') osc.frequency.exponentialRampToValueAtTime(1568, t + 0.35);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'finish' ? 0.6 : 0.18));
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  private burst(duration: number, freq: number, level: number, type: BiquadFilterType): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const env = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(0.9, level);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
  }

  dispose(): void {
    this.running = false;
    this.oscA?.stop();
    this.oscB?.stop();
    this.oscSub?.stop();
    this.noise?.stop();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

export function createAudio(): HorizonAudio {
  return new HorizonAudio();
}
