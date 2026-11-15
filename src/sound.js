// After_Hours/src/sound.js
// Procedural Web Audio API Sound Engine (Realistic Footsteps + Game Events)

class SoundManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.volume = 0.72; // Matches default 72% UI slider
    this.isMuted = false;
    this.lastStepTime = 0;
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

  // 6. HUNTER NEARBY HEARTBEAT
  playHeartbeat() {
    this._playTone(68, 36, 0.16, 'sine', 0.38, 0);
    this._playTone(62, 34, 0.22, 'sine', 0.32, 0.18);
  }

  // 7. UI BUTTON CLICK
  playClick() {
    this._playTone(420, 260, 0.06, 'sine', 0.12, 0);
  }
}

export const sound = new SoundManager();
