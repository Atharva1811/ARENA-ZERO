import type { WeaponId } from '../../../shared/types';

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

  public playShoot(weaponId: WeaponId = 'rifle') {
    this.init();
    switch (weaponId) {
      case 'knife':
        this.playKnifeSlash();
        break;
      case 'pistol':
        this.playPistolShoot();
        break;
      case 'sniper':
        this.playSniperShoot();
        break;
      case 'rifle':
      default:
        this.playGunshot();
        break;
    }
  }

  /**
   * Distance-attenuated gunshot sound for remote player weapon fire.
   * Volume falls off with distance and high frequencies are attenuated (air absorption).
   */
  public playRemoteGunshot(distance: number, weaponId: WeaponId = 'rifle') {
    this.init();
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    if (!Number.isFinite(distance) || distance > 85) return;

    try {
      const dist = Math.max(0, distance);
      const t = this.ctx.currentTime;

      const atten = 1 / (1 + 0.12 * dist + 0.006 * dist * dist);
      if (atten < 0.01) return;

      const distFilter = this.ctx.createBiquadFilter();
      distFilter.type = 'lowpass';
      distFilter.frequency.setValueAtTime(Math.max(400, 4200 / (1 + 0.05 * dist)), t);

      const distGain = this.ctx.createGain();
      const baseGain = weaponId === 'sniper' ? 0.55 : weaponId === 'pistol' ? 0.3 : 0.38;
      distGain.gain.setValueAtTime(Math.min(1.0, atten * baseGain), t);

      distGain.connect(distFilter);
      distFilter.connect(this.sfxGain);

      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = weaponId === 'sniper' ? 'triangle' : 'sawtooth';

      const startFreq = weaponId === 'sniper' ? 320 : weaponId === 'pistol' ? 780 : 620;
      const endFreq = weaponId === 'sniper' ? 45 : 75;
      const duration = weaponId === 'sniper' ? 0.22 : 0.10;

      osc.frequency.setValueAtTime(startFreq, t);
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);

      oscGain.gain.setValueAtTime(0.35, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + duration + 0.02);

      osc.connect(oscGain);
      oscGain.connect(distGain);

      // Noise crack
      const noise = this.ctx.createBufferSource();
      const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.04), this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.45;
      noise.buffer = buffer;

      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.setValueAtTime(weaponId === 'sniper' ? 900 : 1400, t);
      nFilter.Q.setValueAtTime(1.5, t);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.25, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(distGain);

      osc.start(t);
      osc.stop(t + duration + 0.02);
      noise.start(t);
    } catch {}
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
   * Crisp, punchy semi-auto pistol shot
   */
  public playPistolShoot() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.08);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

      const noise = this.ctx.createBufferSource();
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.035, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.35;
      noise.buffer = buffer;

      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'highpass';
      nFilter.frequency.setValueAtTime(1600, t);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.18, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.sfxGain);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + 0.09);
      noise.start(t);
    } catch {}
  }

  /**
   * Massive, thunderous anti-materiel sniper shot
   */
  public playSniperShoot() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;

      // Heavy sub-bass boom
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(180, t);
      subOsc.frequency.exponentialRampToValueAtTime(38, t + 0.32);

      subGain.gain.setValueAtTime(0.45, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      subOsc.connect(subGain);
      subGain.connect(this.sfxGain);
      subOsc.start(t);
      subOsc.stop(t + 0.35);

      // Cracking supersonic noise impulse
      const noise = this.ctx.createBufferSource();
      const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.12), this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.55;
      noise.buffer = buffer;

      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.setValueAtTime(1050, t);
      nFilter.Q.setValueAtTime(1.2, t);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.38, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.sfxGain);
      noise.start(t);
    } catch {}
  }

  /**
   * Knife air slash swoosh
   */
  public playKnifeSlash() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;

      // High-to-low swoosh
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, t);
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.12);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.13);

      // Filtered noise blade hiss
      const noise = this.ctx.createBufferSource();
      const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.08), this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.25;
      noise.buffer = buffer;

      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.setValueAtTime(2200, t);
      nFilter.Q.setValueAtTime(2.0, t);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.12, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.sfxGain);
      noise.start(t);
    } catch {}
  }

  /**
   * Knife blade impact on target
   */
  public playKnifeHit() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.10);
    } catch {}
  }

  /**
   * Tactical optical zoom sound when scoping in/out
   */
  public playScopeIn() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(2400, t + 0.08);

      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.09);
    } catch {}
  }

  public playScopeOut() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, t);
      osc.frequency.exponentialRampToValueAtTime(1100, t + 0.07);

      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.08);
    } catch {}
  }

  /**
   * Weapon switch mechanical tactile sound
   */
  public playSwitchWeapon() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(310, t + 0.04);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.05);
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
   * Weapon reload mechanical slide / mag insertion sound
   */
  public playReloadSound() {
    if (!this.ctx || !this.sfxGain || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;

      // Click 1 (Mag release / ejection)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, t);
      osc1.frequency.exponentialRampToValueAtTime(150, t + 0.06);
      gain1.gain.setValueAtTime(0.18, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc1.connect(gain1);
      gain1.connect(this.sfxGain);
      osc1.start(t);
      osc1.stop(t + 0.07);

      // Click 2 (Mag insertion - 0.4s later)
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(320, t + 0.4);
      osc2.frequency.exponentialRampToValueAtTime(680, t + 0.48);
      gain2.gain.setValueAtTime(0.22, t + 0.4);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.50);
      osc2.connect(gain2);
      gain2.connect(this.sfxGain);
      osc2.start(t + 0.4);
      osc2.stop(t + 0.50);

      // Click 3 (Chamber slide pull / bolt rack - 0.8s later)
      const osc3 = this.ctx.createOscillator();
      const gain3 = this.ctx.createGain();
      osc3.type = 'sawtooth';
      osc3.frequency.setValueAtTime(750, t + 0.8);
      osc3.frequency.exponentialRampToValueAtTime(220, t + 0.9);
      gain3.gain.setValueAtTime(0.20, t + 0.8);
      gain3.gain.exponentialRampToValueAtTime(0.001, t + 0.92);
      osc3.connect(gain3);
      gain3.connect(this.sfxGain);
      osc3.start(t + 0.8);
      osc3.stop(t + 0.92);
    } catch {}
  }

  /**
   * Empty dry-fire hammer click
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
