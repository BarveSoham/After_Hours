// After_Hours/src/sound.js
// Procedural Web Audio API Sound Engine (Realistic Footsteps + Game Events)

class SoundManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    const savedVol = (typeof localStorage !== 'undefined') ? localStorage.getItem('afterHoursVolume') : null;
    this.volume = savedVol !== null ? Math.max(0, Math.min(1, Number(savedVol) / 100)) : 0.70;
    this.isMuted = false;
    this.lastStepTime = 0;
    this.lastChannelTick = 0;
    this.stepIsLeft = true;
    this.surface = 'stone'; // 'stone' | 'wood' | 'gravel'
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);

      // Pre-generate 2-second white noise buffer for realistic footsteps & textures
      const bufferSize = this.ctx.sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.isMuted ? 0 : this.volume,
        this.ctx.currentTime,
        0.02
      );
    }
  }

  // Optional: Switch surface between 'stone' (Quad), 'wood' (Library), and 'gravel' (Grounds)
  setSurface(surfaceType) {
    if (['stone', 'wood', 'gravel'].includes(surfaceType)) {
      this.surface = surfaceType;
    }
  }

  // Helper: Filtered noise slice with optional stereo panning
  _playNoiseBurst({
    delay = 0,
    duration = 0.06,
    filterType = 'bandpass',
    freq = 1000,
    endFreq = null,
    Q = 1.5,
    gainPeak = 0.25,
    pan = 0
  }) {
    this.init();
    const start = this.ctx.currentTime + delay;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const maxOffset = Math.max(0.01, this.noiseBuffer.duration - duration - 0.05);
    const randomOffset = Math.random() * maxOffset;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, start);
    if (endFreq) {
      filter.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    }
    filter.Q.value = Q;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + Math.min(0.006, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter);
    filter.connect(gain);

    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, start);
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else {
      gain.connect(this.masterGain);
    }

    src.start(start, randomOffset, duration + 0.01);
    src.stop(start + duration + 0.01);
  }

  // Helper: Sub-impact body thump
  _playBodyThump({ delay = 0, startFreq = 110, endFreq = 42, duration = 0.075, gainPeak = 0.25, pan = 0 }) {
    this.init();
    const start = this.ctx.currentTime + delay;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, start);
    osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);

    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, start);
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else {
      gain.connect(this.masterGain);
    }

    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  // Helper: Tonal note for UI, Task Complete, Victory, Death
  _playTone(freq, endFreq, duration, type = 'sine', gainPeak = 0.25, delay = 0) {
    this.init();
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    }

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(gainPeak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(start);
    osc.stop(start + duration);
  }

  // Internal realistic two-phase heel-to-toe footstep synthesizer
  _triggerFootstep(isRunning) {
    this.init();
    const intensity = isRunning ? 1.0 : 0.56;
    const pitchVar = (Math.random() - 0.5) * 0.14;
    const gaitOffset = this.stepIsLeft ? 1.03 : 0.97;
    const pan = this.stepIsLeft ? -0.14 : 0.14;
    this.stepIsLeft = !this.stepIsLeft;

    const toeDelay = isRunning ? 0.032 : 0.058;

    if (this.surface === 'stone') {
      // 1. Heel strike + sub-thud
      this._playBodyThump({
        delay: 0,
        startFreq: (isRunning ? 128 : 98) * gaitOffset,
        endFreq: 42,
        duration: isRunning ? 0.07 : 0.06,
        gainPeak: 0.32 * intensity,
        pan
      });
      this._playNoiseBurst({
        delay: 0,
        duration: 0.036,
        filterType: 'bandpass',
        freq: 1450 * (1 + pitchVar) * gaitOffset,
        Q: 2.2,
        gainPeak: 0.26 * intensity,
        pan
      });

      // 2. Forefoot sole roll
      this._playNoiseBurst({
        delay: toeDelay,
        duration: isRunning ? 0.055 : 0.048,
        filterType: 'bandpass',
        freq: 920 * (1 + pitchVar),
        endFreq: 640,
        Q: 1.5,
        gainPeak: 0.21 * intensity,
        pan
      });

      // 3. Subtle campus quad echo
      this._playNoiseBurst({
        delay: toeDelay + 0.035,
        duration: 0.09,
        filterType: 'lowpass',
        freq: 780,
        gainPeak: 0.06 * intensity,
        pan: -pan
      });
    } else if (this.surface === 'wood') {
      // 1. Hollow floorboard resonance
      this._playBodyThump({
        delay: 0,
        startFreq: (isRunning ? 152 : 122) * gaitOffset,
        endFreq: 56,
        duration: 0.095,
        gainPeak: 0.42 * intensity,
        pan
      });
      this._playNoiseBurst({
        delay: 0,
        duration: 0.04,
        filterType: 'bandpass',
        freq: 720 * (1 + pitchVar),
        Q: 2.8,
        gainPeak: 0.22 * intensity,
        pan
      });

      // 2. Sole tap
      this._playBodyThump({
        delay: toeDelay,
        startFreq: 135 * gaitOffset,
        endFreq: 62,
        duration: 0.075,
        gainPeak: 0.25 * intensity,
        pan
      });
      this._playNoiseBurst({
        delay: toeDelay,
        duration: 0.045,
        filterType: 'lowpass',
        freq: 650,
        gainPeak: 0.16 * intensity,
        pan
      });

      // 3. Occasional subtle floorboard creak
      if (Math.random() < 0.28) {
        this._playNoiseBurst({
          delay: toeDelay + 0.015,
          duration: 0.11,
          filterType: 'bandpass',
          freq: 420 + Math.random() * 180,
          endFreq: 310,
          Q: 14,
          gainPeak: 0.055 * intensity,
          pan
        });
      }
    } else if (this.surface === 'gravel') {
      // 1. Weight compression thud
      this._playBodyThump({
        delay: 0,
        startFreq: 95 * gaitOffset,
        endFreq: 38,
        duration: 0.07,
        gainPeak: 0.26 * intensity,
        pan
      });

      // 2. Multi-grain pebble crunch (heel -> mid -> toe)
      const grains = [
        { d: 0.0, dur: 0.055, f: 2100 },
        { d: toeDelay * 0.65, dur: 0.065, f: 2850 },
        { d: toeDelay + 0.02, dur: 0.085, f: 1750 }
      ];
      grains.forEach((g) => {
        this._playNoiseBurst({
          delay: g.d,
          duration: g.dur,
          filterType: 'bandpass',
          freq: g.f * (1 + (Math.random() - 0.5) * 0.25),
          endFreq: g.f * 0.72,
          Q: 1.3,
          gainPeak: 0.24 * intensity,
          pan
        });
      });
    }

    // Subtle coat/clothing rustle when sprinting
    if (isRunning) {
      this._playNoiseBurst({
        delay: 0.015,
        duration: 0.11,
        filterType: 'bandpass',
        freq: 520,
        Q: 1.1,
        gainPeak: 0.075,
        pan: -pan
      });
    }
  }

  // 1. WALKING FOOTSTEP (Call inside movement loop when walking)
  playWalkStep() {
    this.init();
    const now = performance.now();
    const cadence = 485 + (Math.random() * 24 - 12);
    if (now - this.lastStepTime < cadence) return;
    this.lastStepTime = now;
    this._triggerFootstep(false);
  }

  // 2. RUNNING FOOTSTEP (Call inside movement loop when sprinting)
  playRunStep() {
    this.init();
    const now = performance.now();
    const cadence = 285 + (Math.random() * 18 - 9);
    if (now - this.lastStepTime < cadence) return;
    this.lastStepTime = now;
    this._triggerFootstep(true);
  }

  // 3. TASK COMPLETED
  playTaskComplete() {
    this._playTone(523.25, 523.25, 0.35, 'triangle', 0.24, 0);
    this._playTone(783.99, 783.99, 0.55, 'sine', 0.28, 0.12);
    this._playTone(1046.5, 1046.5, 0.65, 'sine', 0.16, 0.22);
  }

  // 4. PLAYER DEAD / ELIMINATED
  playDead() {
    this._playNoiseBurst({
      delay: 0,
      duration: 0.35,
      filterType: 'bandpass',
      freq: 1200,
      Q: 1.4,
      gainPeak: 0.42
    });
    this._playTone(160, 32, 0.95, 'sawtooth', 0.32, 0);
    this._playTone(110, 28, 1.1, 'sine', 0.38, 0.05);
  }

  // 5. VICTORY
  playVictory() {
    const notes = [293.66, 369.99, 440.0, 587.33];
    notes.forEach((freq, idx) => {
      this._playTone(freq, freq, 0.85, 'triangle', 0.22, idx * 0.13);
    });
  }

  // 6. HUNTER NEARBY HEARTBEAT (Dynamic intensity based on danger proximity)
  playHeartbeat(intensity = 1.0) {
    const scale = Math.max(0.2, Math.min(1.2, intensity));
    this._playTone(68, 36, 0.16, 'sine', 0.40 * scale, 0);
    this._playTone(62, 34, 0.22, 'sine', 0.34 * scale, 0.18);
  }

  // 7. UI BUTTON CLICK
  playClick() {
    this._playTone(420, 260, 0.06, 'sine', 0.12, 0);
  }

  // 8. HUNTER ATTACK SWING
  playAttack() {
    this._playNoiseBurst({
      delay: 0,
      duration: 0.22,
      filterType: 'bandpass',
      freq: 1800,
      endFreq: 340,
      Q: 1.2,
      gainPeak: 0.38
    });
    this._playTone(280, 75, 0.20, 'sawtooth', 0.22, 0);
  }

  // 9. HUNTER HIT IMPACT
  playHit() {
    this._playBodyThump({
      delay: 0,
      startFreq: 180,
      endFreq: 35,
      duration: 0.18,
      gainPeak: 0.65
    });
    this._playNoiseBurst({
      delay: 0,
      duration: 0.14,
      filterType: 'bandpass',
      freq: 950,
      Q: 2.0,
      gainPeak: 0.40
    });
  }

  // 10. TERMINAL BYPASS INITIATED
  playChannelStart() {
    this._playTone(440, 660, 0.10, 'sine', 0.18, 0);
    this._playTone(880, 1100, 0.12, 'triangle', 0.12, 0.08);
  }

  // 11. TERMINAL BYPASS TICK
  playChannelTick() {
    const now = performance.now();
    if (this.lastChannelTick && (now - this.lastChannelTick < 170)) return;
    this.lastChannelTick = now;
    this._playTone(600 + Math.random() * 80, 520, 0.04, 'sine', 0.08, 0);
  }

  // 12. TERMINAL BYPASS CANCELLED
  playChannelCancel() {
    this._playTone(550, 220, 0.09, 'sine', 0.12, 0);
  }

  // 13. EXIT GATES POWERED / UNLOCKED
  playGateUnlocked() {
    this._playBodyThump({ delay: 0, startFreq: 140, endFreq: 30, duration: 0.45, gainPeak: 0.55 });
    this._playNoiseBurst({ delay: 0, duration: 0.35, filterType: 'lowpass', freq: 450, gainPeak: 0.35 });
    this._playTone(440, 440, 0.30, 'triangle', 0.25, 0.15);
    this._playTone(554.37, 554.37, 0.30, 'triangle', 0.25, 0.35);
    this._playTone(659.25, 659.25, 0.50, 'triangle', 0.30, 0.55);
  }

  // 14. MATCH START GONG
  playMatchStart() {
    this._playBodyThump({ delay: 0, startFreq: 95, endFreq: 32, duration: 1.2, gainPeak: 0.45 });
    this._playTone(130.81, 130.81, 1.4, 'sine', 0.30, 0.05);
    this._playTone(196.00, 196.00, 1.2, 'triangle', 0.20, 0.15);
  }

  // 15. DISTANT ELIMINATION NOTIFICATION
  playScream() {
    this._playNoiseBurst({ delay: 0, duration: 0.45, filterType: 'bandpass', freq: 1100, endFreq: 400, Q: 3.0, gainPeak: 0.28 });
    this._playTone(320, 140, 0.55, 'sawtooth', 0.15, 0.02);
  }

  // 16. DEFEAT / LOSS
  playGameOver() {
    this._playTone(146.83, 110.0, 1.2, 'sawtooth', 0.25, 0);
    this._playTone(98.0, 65.4, 1.5, 'sine', 0.35, 0.2);
  }
}

export const sound = new SoundManager();
