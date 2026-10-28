export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientNoiseNode: AudioBufferSourceNode | null = null;
  private isMuted: boolean = false;
  private isAmbientPlaying: boolean = false;
  private masterVolume: number = 0.8;
  private sfxVolume: number = 0.8;
  private musicVolume: number = 0.5;

  constructor() {
    // AudioContext will be initialized on first user interaction to respect browser autoplay policies
  }

  public init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.setValueAtTime(this.musicVolume, this.ctx.currentTime);
      this.musicGain.connect(this.masterGain);

      this.startAmbientSeaBreeze();
    } catch {
      // Audio not supported or blocked
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  public setVolumes(master: number, sfx: number, music: number) {
    this.masterVolume = THREE_clamp(master, 0, 1);
    this.sfxVolume = THREE_clamp(sfx, 0, 1);
    this.musicVolume = THREE_clamp(music, 0, 1);

    if (this.ctx) {
      const t = this.ctx.currentTime;
      if (this.masterGain) this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, t);
      if (this.sfxGain) this.sfxGain.gain.setValueAtTime(this.sfxVolume, t);
      if (this.musicGain) this.musicGain.gain.setValueAtTime(this.musicVolume, t);
    }
  }

  /**
   * Procedural ambient ocean surf / island wind generator using pink noise and LFO
   */
  private startAmbientSeaBreeze() {
    if (!this.ctx || !this.musicGain || this.isAmbientPlaying) return;

    try {
      // Create 5 seconds of pink noise buffer
      const bufferSize = this.ctx.sampleRate * 5;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
        b6 = white * 0.115926;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      // Lowpass filter modulated by LFO to simulate ocean swells
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, this.ctx.currentTime);
      filter.Q.setValueAtTime(1.8, this.ctx.currentTime);

      const lfo = this.ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.12, this.ctx.currentTime); // ~8 sec ocean wave period
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(180, this.ctx.currentTime);

      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      const ambientGain = this.ctx.createGain();
      ambientGain.gain.setValueAtTime(0.35, this.ctx.currentTime);

      noise.connect(filter);
      filter.connect(ambientGain);
      ambientGain.connect(this.musicGain);

      noise.start();
      lfo.start();

      this.ambientNoiseNode = noise;
      this.isAmbientPlaying = true;
    } catch {
      // Ambient generation failure fallback
    }
  }

  /**
   * Footstep sound when walking on sand/grass
   */
  public playFootstep(surface: 'sand' | 'grass' | 'stone' = 'sand') {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      const baseFreq = surface === 'stone' ? 180 : surface === 'grass' ? 120 : 90;
      const jitter = (Math.random() - 0.5) * 20;

      osc.type = surface === 'stone' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(baseFreq + jitter, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.08);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(surface === 'stone' ? 800 : 350, t);

      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + 0.09);
    } catch {}
  }

  /**
   * Jump sound
   */
  public playJump() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(260, t + 0.15);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + 0.16);
    } catch {}
  }

  /**
   * Sparkling crystal collection chime
   */
  public playCrystalPickup(index: number = 0) {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;

    try {
      const t = this.ctx.currentTime;
      // Arpeggiated cheerful chime
      const baseFreqs = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5, E5, G5, C6, E6
      const pitchOffset = index * 2;

      baseFreqs.forEach((freq, idx) => {
        const noteTime = t + idx * 0.06;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * Math.pow(1.05946, pitchOffset), noteTime);

        // Add subtle vibrato
        const vibrato = this.ctx!.createOscillator();
        vibrato.frequency.value = 8;
        const vGain = this.ctx!.createGain();
        vGain.gain.value = 6;
        vibrato.connect(osc.frequency);
        vibrato.start(noteTime);
        vibrato.stop(noteTime + 0.6);

        gain.gain.setValueAtTime(0, noteTime);
        gain.gain.linearRampToValueAtTime(0.2, noteTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.6);

        osc.connect(gain);
        gain.connect(this.sfxGain!);

        osc.start(noteTime);
        osc.stop(noteTime + 0.65);
      });
    } catch {}
  }

  /**
   * Resonant majestic chime when all crystals gathered and shrine unlocks
   */
  public playShrineUnlocked() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;

    try {
      const t = this.ctx.currentTime;
      const chord = [261.63, 329.63, 392.00, 523.25, 659.25]; // C major chord

      chord.forEach((freq, idx) => {
        const noteTime = t + idx * 0.12;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0, noteTime);
        gain.gain.linearRampToValueAtTime(0.25, noteTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 2.0);

        osc.connect(gain);
        gain.connect(this.sfxGain!);

        osc.start(noteTime);
        osc.stop(noteTime + 2.1);
      });
    } catch {}
  }

  /**
   * Triumphant fanfare when activating the shrine to complete the quest
   */
  public playVictoryFanfare() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;

    try {
      const t = this.ctx.currentTime;
      const notes = [
        { f: 392.00, start: 0.0, dur: 0.2 }, // G4
        { f: 523.25, start: 0.2, dur: 0.2 }, // C5
        { f: 659.25, start: 0.4, dur: 0.2 }, // E5
        { f: 783.99, start: 0.6, dur: 0.5 }, // G5
        { f: 659.25, start: 1.1, dur: 0.2 }, // E5
        { f: 783.99, start: 1.3, dur: 0.8 }, // G5
        { f: 1046.50, start: 2.1, dur: 1.5 } // C6
      ];

      notes.forEach(({ f, start, dur }) => {
        const noteTime = t + start;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, noteTime);

        gain.gain.setValueAtTime(0, noteTime);
        gain.gain.linearRampToValueAtTime(0.28, noteTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + dur);

        osc.connect(gain);
        gain.connect(this.sfxGain!);

        osc.start(noteTime);
        osc.stop(noteTime + dur + 0.05);
      });
    } catch {}
  }

  /**
   * Simple UI click sound
   */
  public playUIClick() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.exponentialRampToValueAtTime(200, t + 0.04);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + 0.045);
    } catch {}
  }

  public dispose() {
    if (this.ambientNoiseNode) {
      try { this.ambientNoiseNode.stop(); } catch {}
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      try { this.ctx.close(); } catch {}
    }
    this.ctx = null;
  }
}

function THREE_clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
