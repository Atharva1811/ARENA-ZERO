export class FPSAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.8;

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
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);
    } catch {
      // Web Audio unsupported
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  public setMasterVolume(val: number) {
    this.setVolume(val);
    this.setMuted(val <= 0);
  }

  public playShoot() {
    this.init();
    this.playGunshot();
  }

  public playHitMarker(isHeadshot: boolean = false) {
    this.init();
    this.playHitDing(isHeadshot);
  }

  public playReload() {
    this.init();
    this.playReloadSound();
  }

  public playRespawn() {
    this.init();
    this.playRespawnSound();
  }

  /**
   * Snappy pulse laser rifle shot
   */
  public playGunshot() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(680, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.11);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      // Add noise transient for punch
      const noise = this.ctx.createBufferSource();
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
      noise.buffer = buffer;

      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'highpass';
      nFilter.frequency.setValueAtTime(1200, t);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.2, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.sfxGain);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + 0.12);
      noise.start(t);
    } catch {}
  }

  /**
   * Crisp hit confirmation ding (Call of Duty / Quake style)
   */
  public playHitDing(isHeadshot: boolean = false) {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const freq = isHeadshot ? 1760 : 1320; // A6 for headshot, E6 for body
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (isHeadshot ? 0.22 : 0.12));

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + (isHeadshot ? 0.23 : 0.13));
    } catch {}
  }

  /**
   * Player taking damage thud / pain sound
   */
  public playDamageGrunt() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + 0.2);
    } catch {}
  }

  /**
   * Kill / Elimination celebratory fanfare chime
   */
  public playEliminationSound() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const notes = [659.25, 880, 1174.66]; // E5, A5, D6
      notes.forEach((freq, idx) => {
        const noteTime = t + idx * 0.06;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0.22, noteTime);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

        osc.connect(gain);
        gain.connect(this.sfxGain!);

        osc.start(noteTime);
        osc.stop(noteTime + 0.36);
      });
    } catch {}
  }

  /**
   * Weapon Reload mechanical clicks
   */
  public playReloadSound() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      // Click 1: Eject mag
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(400, t);
      osc1.frequency.exponentialRampToValueAtTime(150, t + 0.06);
      gain1.gain.setValueAtTime(0.18, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc1.connect(gain1);
      gain1.connect(this.sfxGain);
      osc1.start(t);
      osc1.stop(t + 0.07);

      // Click 2: Insert new mag (at 0.9s)
      const t2 = t + 0.9;
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(320, t2);
      osc2.frequency.exponentialRampToValueAtTime(650, t2 + 0.08);
      gain2.gain.setValueAtTime(0.2, t2);
      gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.09);
      osc2.connect(gain2);
      gain2.connect(this.sfxGain);
      osc2.start(t2);
      osc2.stop(t2 + 0.09);
    } catch {}
  }

  /**
   * Dry fire click when ammo is 0
   */
  public playEmptyClick() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(850, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.03);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.035);
    } catch {}
  }

  /**
   * Respawn shield hum
   */
  public playRespawnSound() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.3);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.35);
    } catch {}
  }

  public dispose() {
    if (this.ctx && this.ctx.state !== 'closed') {
      try { this.ctx.close(); } catch {}
    }
    this.ctx = null;
  }
}
