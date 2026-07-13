/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class RetroAudioEngine {
  private ctx: AudioContext | null = null;
  private sfxEnabled: boolean = true;
  private musicEnabled: boolean = false;
  private sfxVolume: number = 0.5;
  private musicVolume: number = 0.5;
  private musicStyle: 'A' | 'B' | 'C' | 'D' = 'A';
  
  // Music Scheduler State
  private schedulerIntervalId: any = null;
  private worker: Worker | null = null;
  private schedulerActive: boolean = false;
  private nextNoteTime: number = 0;
  private currentStep: number = 0; // 0 to 31 step in our generative loops
  private phraseCount: number = 0; // Number of loops before evolving the music
  private tempoBPM: number = 135; // BPM (Quarter notes per minute)
  private stepDuration: number = 0; // Duration of 1 step (eighth note) in seconds

  // Generative Pattern Slots
  private melodyPattern: number[] = [];
  private harmonyPattern: number[] = [];
  private bassPattern: number[] = [];

  // Safari Tab Flicker Fix State
  private keepAliveOsc: OscillatorNode | null = null;
  private silentGain: GainNode | null = null;
  private suspendTimeoutId: any = null;
  private compressor: DynamicsCompressorNode | null = null;

  constructor() {
    // Try to load initial settings from localStorage
    if (typeof window !== 'undefined') {
      const sfx = window.localStorage.getItem('retroblocks_sfx_enabled');
      const bgm = window.localStorage.getItem('retroblocks_bgm_enabled');
      const sfxVol = window.localStorage.getItem('retroblocks_sfx_volume');
      const bgmVol = window.localStorage.getItem('retroblocks_bgm_volume');
      const style = window.localStorage.getItem('retroblocks_music_style') as 'A' | 'B' | 'C' | 'D' | null;
      
      if (sfx !== null) this.sfxEnabled = sfx === 'true';
      if (bgm !== null) this.musicEnabled = bgm === 'true';
      if (sfxVol !== null) this.sfxVolume = parseFloat(sfxVol);
      if (bgmVol !== null) this.musicVolume = parseFloat(bgmVol);
      if (style !== null && ['A', 'B', 'C', 'D'].includes(style)) {
        this.musicStyle = style;
      }
    }
    // Set tempo depending on style
    if (this.musicStyle === 'A') {
      this.tempoBPM = 135;
    } else if (this.musicStyle === 'B') {
      this.tempoBPM = 100;
    } else if (this.musicStyle === 'C') {
      this.tempoBPM = 140;
    } else if (this.musicStyle === 'D') {
      this.tempoBPM = 140;
    }
    // Calculate step duration (eighth note is half a beat)
    this.stepDuration = 60 / this.tempoBPM / 2;
  }

  private initCtx() {
    if (this.suspendTimeoutId) {
      clearTimeout(this.suspendTimeoutId);
      this.suspendTimeoutId = null;
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        
        // --- MASTER LIMITER COMPRESSOR ---
        this.compressor = this.ctx.createDynamicsCompressor();
        // Start compressing when the signal gets close to clipping threshold
        this.compressor.threshold.setValueAtTime(-1.5, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(4.0, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(12.0, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.08, this.ctx.currentTime);
        this.compressor.connect(this.ctx.destination);

        // --- BULLETPROOF SAFARI FIX ---
        // 1. Assign to class properties to prevent Garbage Collection
        this.keepAliveOsc = this.ctx.createOscillator();
        this.silentGain = this.ctx.createGain();
        
        // 2. Use a microscopic value instead of absolute 0 to bypass the optimizer
        this.silentGain.gain.value = 0.00001; 
        
        this.keepAliveOsc.connect(this.silentGain);
        this.silentGain.connect(this.ctx.destination);
        
        this.keepAliveOsc.start();
        // ------------------------------
      }
    }
    
    // Ensure we actually resume the context if the browser suspended it
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private connectToDestination(node: AudioNode) {
    if (!this.ctx) return;
    if (this.compressor) {
      node.connect(this.compressor);
    } else {
      node.connect(this.ctx.destination);
    }
  }

  private initWorker() {
    if (this.worker) return;

    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      try {
        const workerCode = `
          let timerId = null;
          let interval = 100;

          self.onmessage = function(e) {
            if (e.data === "start") {
              if (timerId) clearInterval(timerId);
              timerId = setInterval(function() {
                self.postMessage("tick");
              }, interval);
            } else if (e.data === "stop") {
              if (timerId) {
                clearInterval(timerId);
                timerId = null;
              }
            } else if (e.data.interval) {
              interval = e.data.interval;
              if (timerId) {
                clearInterval(timerId);
                timerId = setInterval(function() {
                  self.postMessage("tick");
                }, interval);
              }
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);
        
        this.worker.onmessage = (e) => {
          if (e.data === "tick") {
            this.handleTick();
          }
        };
      } catch (err) {
        console.error("Failed to initialize background music worker:", err);
      }
    }
  }

  private handleTick() {
    if (!this.ctx || !this.schedulerActive) return;
    const lookahead = 0.2;
    while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
      this.scheduleNextNote();
    }
  }

  private scheduleSuspend() {
    if (this.suspendTimeoutId) {
      clearTimeout(this.suspendTimeoutId);
      this.suspendTimeoutId = null;
    }
    if (!this.schedulerActive && this.ctx && this.ctx.state === 'running') {
      this.suspendTimeoutId = setTimeout(() => {
        if (!this.schedulerActive && this.ctx && this.ctx.state === 'running') {
          this.ctx.suspend().catch(err => console.error("Failed to suspend AudioContext:", err));
        }
      }, 2000); // Suspend after 2 seconds of silence
    }
  }

  private suspendImmediately() {
    if (this.suspendTimeoutId) {
      clearTimeout(this.suspendTimeoutId);
      this.suspendTimeoutId = null;
    }
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(err => console.error("Failed to suspend AudioContext:", err));
    }
  }

  public toggleSoundEffects(): boolean {
    this.sfxEnabled = !this.sfxEnabled;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('retroblocks_sfx_enabled', String(this.sfxEnabled));
    }
    if (this.sfxEnabled) {
      this.playRotate();
    } else {
      if (!this.schedulerActive) {
        this.suspendImmediately();
      }
    }
    return this.sfxEnabled;
  }

  public toggleMusic(): boolean {
    this.musicEnabled = !this.musicEnabled;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('retroblocks_bgm_enabled', String(this.musicEnabled));
    }
    if (this.musicEnabled) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
    return this.musicEnabled;
  }

  public getSFXEnabled(): boolean {
    return this.sfxEnabled;
  }

  public getMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public getSFXVolume(): number {
    return this.sfxVolume;
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public setSFXVolume(vol: number) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('retroblocks_sfx_volume', String(this.sfxVolume));
    }
  }

  public setMusicVolume(vol: number) {
    this.musicVolume = Math.max(0, Math.min(1, vol));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('retroblocks_bgm_volume', String(this.musicVolume));
    }
  }

  public getMusicStyle(): 'A' | 'B' | 'C' | 'D' {
    return this.musicStyle;
  }

  public setMusicStyle(style: 'A' | 'B' | 'C' | 'D') {
    this.musicStyle = style;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('retroblocks_music_style', style);
    }
    // Set tempo depending on style
    if (style === 'A') {
      this.tempoBPM = 135;
    } else if (style === 'B') {
      this.tempoBPM = 100;
    } else if (style === 'C') {
      this.tempoBPM = 140;
    } else if (style === 'D') {
      this.tempoBPM = 140;
    }
    this.stepDuration = 60 / this.tempoBPM / 2;
    
    // Regenerate current phrase immediately if music is actively running
    if (this.musicEnabled) {
      this.generatePhrase();
    }
  }

  // --- Retro Sound Effects (SFX) ---

  private playTone(freq: number, type: OscillatorType, duration: number, gainStart: number, gainEnd: number, pitchGlide?: number) {
    if (!this.sfxEnabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    if (pitchGlide) {
      osc.frequency.exponentialRampToValueAtTime(pitchGlide, this.ctx.currentTime + duration);
    }

    // Scale by sfxVolume
    const finalGainStart = gainStart * this.sfxVolume;
    const finalGainEnd = gainEnd * this.sfxVolume;

    gainNode.gain.setValueAtTime(finalGainStart, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(finalGainEnd, 0.0001), this.ctx.currentTime + duration);

    osc.connect(gainNode);
    this.connectToDestination(gainNode);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);

    this.scheduleSuspend();
  }

  public playMove() {
    // Short transient blip
    this.playTone(180, 'triangle', 0.06, 0.15, 0.01);
  }

  public playRotate() {
    // Upward soft retro chirp in a lower register, similar to playMove
    this.playTone(220, 'triangle', 0.08, 0.12, 0.01, 280);
  }

  public playDrop() {
    // Snappy downward pop
    this.playTone(200, 'triangle', 0.12, 0.2, 0.01, 80);
  }

  public playLineClear(linesCount: number) {
    if (!this.sfxEnabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Ascending arpeggio chord based on cleared lines
    // 1 line: C4-E4
    // 2 lines: C4-E4-G4
    // 3 lines: C4-E4-G4-C5
    // 4 lines (RETROBLOCKS!): Awesome major scale flourish
    const notes = [60, 64, 67, 72, 76, 79]; // C4, E4, G4, C5, E5, G5
    const count = Math.min(linesCount + 2, notes.length);

    for (let i = 0; i < count; i++) {
      const freq = this.midiToFreq(notes[i]);
      const timeOffset = i * 0.08;

      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = linesCount === 4 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + timeOffset);

      gainNode.gain.setValueAtTime(0.12 * this.sfxVolume, now + timeOffset);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + timeOffset + 0.25);

      // Low pass filter for a warm retro tone
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1500, now);

      osc.connect(gainNode);
      gainNode.connect(filter);
      this.connectToDestination(filter);

      osc.start(now + timeOffset);
      osc.stop(now + timeOffset + 0.3);
    }
    this.scheduleSuspend();
  }

  public playGameOver() {
    if (!this.sfxEnabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [62, 58, 55, 50]; // D4, Bb3, G3, D3 downward melancholy chord
    for (let i = 0; i < notes.length; i++) {
      const freq = this.midiToFreq(notes[i]);
      const timeOffset = i * 0.15;

      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + timeOffset);
      osc.frequency.linearRampToValueAtTime(freq - 50, now + timeOffset + 0.4);

      gainNode.gain.setValueAtTime(0.12 * this.sfxVolume, now + timeOffset);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + timeOffset + 0.45);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now + timeOffset);
      filter.frequency.exponentialRampToValueAtTime(100, now + timeOffset + 0.4);

      osc.connect(gainNode);
      gainNode.connect(filter);
      this.connectToDestination(filter);

      osc.start(now + timeOffset);
      osc.stop(now + timeOffset + 0.5);
    }
    this.scheduleSuspend();
  }

  // --- Background Music (BGM) Engine ---

  private midiToFreq(midi: number): number {
    if (midi <= 0) return 0;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private playKickDrum(now: number) {
    if (!this.ctx || this.musicVolume <= 0) return;
    try {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = 0; // Initialize immediately to prevent default gain of 1.0 leaking

      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);

      gainNode.gain.setValueAtTime(0.0, now);
      gainNode.gain.linearRampToValueAtTime(0.18 * this.musicVolume, now + 0.005); // Smooth 5ms attack instead of step jump
      gainNode.gain.linearRampToValueAtTime(0.0, now + 0.14); // Pure linear ramp down to 0 prevents click

      osc.connect(gainNode);
      this.connectToDestination(gainNode);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      // Ignore audio scheduling exceptions
    }
  }

  private playHiHat(now: number) {
    if (!this.ctx || this.musicVolume <= 0) return;
    try {
      const bufferSize = this.ctx.sampleRate * 0.05; // 50ms of noise
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(7500, now);

      const gainNode = this.ctx.createGain();
      gainNode.gain.value = 0; // Initialize immediately to prevent default gain of 1.0 leaking

      gainNode.gain.setValueAtTime(0.0, now);
      gainNode.gain.linearRampToValueAtTime(0.035 * this.musicVolume, now + 0.003); // Smooth 3ms attack instead of step jump
      gainNode.gain.linearRampToValueAtTime(0.0, now + 0.045); // Pure linear ramp down to 0 prevents click

      noiseNode.connect(filter);
      filter.connect(gainNode);
      this.connectToDestination(gainNode);

      noiseNode.start(now);
      noiseNode.stop(now + 0.05);
    } catch (e) {
      // Ignore audio scheduling exceptions
    }
  }

  private generatePhrase() {
    this.melodyPattern = [];
    this.harmonyPattern = [];
    this.bassPattern = [];

    if (this.musicStyle === 'A') {
      // Style A: Retro Cyber-Pluck (driving synth lead in A Minor / pentatonic)
      const chords = [
        { root: 45, tones: [57, 60, 64, 69, 72, 76] }, // Am: A2 root, chord tones
        { root: 41, tones: [53, 57, 60, 65, 69, 72] }, // F:  F2 root, chord tones
        { root: 48, tones: [48, 52, 55, 60, 64, 67] }, // C:  C3 root, chord tones
        { root: 43, tones: [55, 59, 62, 67, 71, 74] }  // G:  G2 root, chord tones
      ];
      // A minor pentatonic scale for safe melody notes
      const scale = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91]; // A4, C5, D5, E5, G5, A5, C6, D6, E6, G6
      let lastMelodyNote = scale[Math.floor(Math.random() * 4) + 2]; // Start around C5-E5-G5

      for (let step = 0; step < 32; step++) {
        const chordIdx = Math.floor(step / 8) % 4;
        const currentChord = chords[chordIdx];
        const stepInBar = step % 8;

        // --- Bass Pattern ---
        // Rhythm: step 0 (downbeat root), step 3 (syncopated octave), step 4 (backbeat fifth), step 6 (syncopated chord tone)
        if (stepInBar === 0) {
          this.bassPattern.push(currentChord.root);
        } else if (stepInBar === 3) {
          this.bassPattern.push(currentChord.root + 12); // Octave jump
        } else if (stepInBar === 4) {
          this.bassPattern.push(currentChord.root + 7); // Fifth
        } else if (stepInBar === 6) {
          this.bassPattern.push(currentChord.tones[1]); // Mid chord tone
        } else {
          this.bassPattern.push(0); // Rest
        }

        // --- Harmony / Chord Accompaniment ---
        // Offbeat pulses on step 2 and 5 to create a nice dynamic counter-rhythm
        if (stepInBar === 2 || stepInBar === 5) {
          this.harmonyPattern.push(currentChord.tones[Math.floor(Math.random() * 2) + 1]);
        } else {
          this.harmonyPattern.push(0);
        }

        // --- Melody Walk ---
        const isStrongBeat = stepInBar % 2 === 0;
        const playChance = isStrongBeat ? 0.65 : 0.3;

        if (Math.random() < playChance) {
          let scaleIdx = scale.indexOf(lastMelodyNote);
          if (scaleIdx === -1) scaleIdx = 3;

          // Neighbor walk
          const stepChange = Math.floor(Math.random() * 5) - 2; // -2, -1, 0, 1, 2
          let nextScaleIdx = scaleIdx + stepChange;
          if (nextScaleIdx < 0) nextScaleIdx = 0;
          if (nextScaleIdx >= scale.length) nextScaleIdx = scale.length - 1;

          const note = scale[nextScaleIdx];
          this.melodyPattern.push(note);
          lastMelodyNote = note;
        } else {
          this.melodyPattern.push(0);
        }
      }
    } else if (this.musicStyle === 'B') {
      // Style B: Chill Lofi / Jazz-Hop (slower tempo, warm major 7th / minor 9th chords, spacious melody)
      const chords = [
        { root: 45, tones: [57, 60, 64, 67, 71] }, // Am9
        { root: 41, tones: [53, 57, 60, 64, 69] }, // Fmaj7/9
        { root: 50, tones: [53, 57, 60, 65, 69] }, // Dm9
        { root: 47, tones: [50, 53, 57, 59, 65] }  // E7alt
      ];
      const scale = [64, 67, 69, 71, 72, 74, 76, 79, 81, 83]; // A minor/Dorian scale notes
      let lastMelodyNote = scale[Math.floor(Math.random() * 4) + 1];

      for (let step = 0; step < 32; step++) {
        const chordIdx = Math.floor(step / 8) % 4;
        const currentChord = chords[chordIdx];
        const stepInBar = step % 8;

        // Bass: simple downbeat and backbeat groove
        if (stepInBar === 0) {
          this.bassPattern.push(currentChord.root);
        } else if (stepInBar === 4) {
          this.bassPattern.push(currentChord.root + 7);
        } else {
          this.bassPattern.push(0);
        }

        // Harmony: long warm pads
        if (stepInBar === 1 || stepInBar === 5) {
          this.harmonyPattern.push(currentChord.tones[Math.floor(Math.random() * 3) + 1]);
        } else {
          this.harmonyPattern.push(0);
        }

        // Melody: spacious, slow, jazzy leaps
        const playChance = stepInBar === 2 || stepInBar === 6 ? 0.4 : 0.15;
        if (Math.random() < playChance) {
          let scaleIdx = scale.indexOf(lastMelodyNote);
          if (scaleIdx === -1) scaleIdx = 2;
          const stepChange = Math.floor(Math.random() * 3) - 1; // -1, 0, 1
          let nextScaleIdx = scaleIdx + stepChange;
          if (nextScaleIdx < 0) nextScaleIdx = 0;
          if (nextScaleIdx >= scale.length) nextScaleIdx = scale.length - 1;
          const note = scale[nextScaleIdx];
          this.melodyPattern.push(note);
          lastMelodyNote = note;
        } else {
          this.melodyPattern.push(0);
        }
      }
    } else if (this.musicStyle === 'C') {
      // Style C: Euro Trance / Techno (pumping bass, hypnotic running arpeggios, soaring hooks)
      // Classic uplifting emotional trance chord progressions:
      const progressions = [
        // Progression 1: Em - C - G - D (Uplifting and driving)
        [
          { root: 40, tones: [52, 55, 59, 64, 67, 71] }, // Em
          { root: 48, tones: [48, 52, 55, 60, 64, 67] }, // C
          { root: 43, tones: [47, 50, 55, 59, 62, 67] }, // G
          { root: 38, tones: [50, 54, 57, 62, 66, 69] }  // D
        ],
        // Progression 2: Am - F - G - Em (Epic, soaring melancholic energy)
        [
          { root: 45, tones: [45, 48, 52, 57, 60, 64] }, // Am
          { root: 41, tones: [41, 45, 48, 53, 57, 60] }, // F
          { root: 43, tones: [43, 47, 50, 55, 59, 62] }, // G
          { root: 40, tones: [40, 43, 47, 52, 55, 59] }  // Em
        ],
        // Progression 3: Em - D - C - D (The Classic Anjunabeats descent)
        [
          { root: 40, tones: [52, 55, 59, 64, 67, 71] }, // Em
          { root: 38, tones: [50, 54, 57, 62, 66, 69] }, // D
          { root: 48, tones: [48, 52, 55, 60, 64, 67] }, // C
          { root: 38, tones: [50, 54, 57, 62, 66, 69] }  // D
        ],
        // Progression 4: C - G - Am - F (Emotional and nostalgic trance theme)
        [
          { root: 48, tones: [48, 52, 55, 60, 64, 67] }, // C
          { root: 43, tones: [43, 47, 50, 55, 59, 62] }, // G
          { root: 45, tones: [45, 48, 52, 57, 60, 64] }, // Am
          { root: 41, tones: [41, 45, 48, 53, 57, 60] }  // F
        ]
      ];

      // Randomly select one of these progressions to ensure a completely non-repetitive loop!
      const chords = progressions[Math.floor(Math.random() * progressions.length)];

      // Interactive pool of dynamic arpeggio patterns:
      const arpPatterns = [
        [0, 2, 1, 3, 2, 4, 3, 5], // High-energy driving
        [5, 4, 3, 2, 4, 3, 2, 1], // Trance waterfall
        [0, 1, 2, 3, 4, 5, 4, 3], // Climbing hill
        [0, 3, 1, 4, 2, 5, 3, 4]  // Interlocking steps
      ];
      const arpIndices = arpPatterns[Math.floor(Math.random() * arpPatterns.length)];

      // Scale for beautiful melodic notes:
      const scale = [64, 67, 69, 71, 74, 76, 79, 81, 83, 86];

      for (let step = 0; step < 32; step++) {
        const chordIdx = Math.floor(step / 8) % 4;
        const currentChord = chords[chordIdx];
        const stepInBar = step % 8;

        // Bass: pumping offbeat and rolling bassline
        if (stepInBar === 0 || stepInBar === 4) {
          this.bassPattern.push(currentChord.root);
        } else if (stepInBar % 2 !== 0) {
          this.bassPattern.push(currentChord.root + 12); // Pumping offbeat octave
        } else {
          // Dynamic rolling bass chance
          this.bassPattern.push(Math.random() < 0.65 ? currentChord.root : currentChord.root + 12);
        }

        // Harmony: fast, soaring arpeggio pattern
        const noteIdx = arpIndices[stepInBar] % currentChord.tones.length;
        this.harmonyPattern.push(currentChord.tones[noteIdx]);

        // Melody: structured phrase with melodic hooks (high-energy soaring trance melody!)
        if (stepInBar === 0) {
          // Strong landing tone (usually high register chord tones)
          const highTone = currentChord.tones[Math.floor(Math.random() * 2) + 3] + 12;
          this.melodyPattern.push(highTone);
        } else if (stepInBar === 2 || stepInBar === 4 || stepInBar === 6) {
          // Offbeat syncopations (classic trance hooks)
          if (Math.random() < 0.75) {
            const hookTone = currentChord.tones[currentChord.tones.length - 1] + (Math.random() < 0.5 ? 12 : 7);
            this.melodyPattern.push(hookTone);
          } else {
            this.melodyPattern.push(0);
          }
        } else if (stepInBar === 3 || stepInBar === 7) {
          // Quick passing scale tones
          if (Math.random() < 0.4) {
            const scaleIdx = Math.floor(Math.random() * scale.length);
            this.melodyPattern.push(scale[scaleIdx]);
          } else {
            this.melodyPattern.push(0);
          }
        } else {
          this.melodyPattern.push(0);
        }
      }
    } else {
      // Style D: Retro Synthwave / Industrial (tense minor theme, pumping 8th note bass, sharp lead)
      const chords = [
        { root: 45, tones: [57, 60, 64, 69, 72, 76] }, // Am
        { root: 46, tones: [58, 62, 65, 70, 74, 78] }, // Bb (tense Phrygian dominant flat-II)
        { root: 41, tones: [53, 57, 60, 65, 69, 72] }, // F
        { root: 40, tones: [52, 56, 59, 64, 68, 71] }  // E7 (V dominant chord)
      ];
      // Phrygian Dominant & Natural minor scale blend for tense sci-fi brutalist sound
      const scale = [69, 70, 73, 74, 76, 77, 80, 81, 82, 85, 86, 89];
      let lastMelodyNote = scale[Math.floor(Math.random() * 3) + 3];

      for (let step = 0; step < 32; step++) {
        const chordIdx = Math.floor(step / 8) % 4;
        const currentChord = chords[chordIdx];
        const stepInBar = step % 8;

        // Bass: pounding, pumping driving eighth notes on EVERY step!
        // Alternates between root and fifth/octave
        const isOffbeat = stepInBar % 2 !== 0;
        if (isOffbeat) {
          this.bassPattern.push(currentChord.root + (Math.random() < 0.3 ? 7 : 12));
        } else {
          this.bassPattern.push(currentChord.root);
        }

        // Harmony: offbeat industrial chords
        if (stepInBar === 2 || stepInBar === 6) {
          this.harmonyPattern.push(currentChord.tones[1]);
        } else {
          this.harmonyPattern.push(0);
        }

        // Melody: fast, syncopated cyber motif
        const playChance = (stepInBar === 1 || stepInBar === 3 || stepInBar === 4 || stepInBar === 7) ? 0.7 : 0.1;
        if (Math.random() < playChance) {
          let scaleIdx = scale.indexOf(lastMelodyNote);
          if (scaleIdx === -1) scaleIdx = 4;
          const stepChange = Math.floor(Math.random() * 5) - 2; // neighbor walk
          let nextScaleIdx = scaleIdx + stepChange;
          if (nextScaleIdx < 0) nextScaleIdx = 0;
          if (nextScaleIdx >= scale.length) nextScaleIdx = scale.length - 1;
          const note = scale[nextScaleIdx];
          this.melodyPattern.push(note);
          lastMelodyNote = note;
        } else {
          this.melodyPattern.push(0);
        }
      }
    }
  }

  private scheduleNextNote() {
    if (!this.ctx || !this.musicEnabled) return;

    const durationInSeconds = this.stepDuration;

    // Retrieve notes for current step
    const bassNote = this.bassPattern[this.currentStep];
    const harmonyNote = this.harmonyPattern[this.currentStep];
    const melodyNote = this.melodyPattern[this.currentStep];

    const now = this.nextNoteTime;

    // --- Play Drums for Style C (Techno/Trance) ---
    if (this.musicStyle === 'C' && this.musicVolume > 0) {
      const stepInBar = this.currentStep % 8;
      // Kick drum on 0, 4 (Four-on-the-floor beat)
      if (stepInBar === 0 || stepInBar === 4) {
        this.playKickDrum(now);
      }
      // Offbeat hi-hat on 2, 6
      if (stepInBar === 2 || stepInBar === 6) {
        this.playHiHat(now);
      } else if ((stepInBar === 1 || stepInBar === 3 || stepInBar === 5 || stepInBar === 7) && Math.random() < 0.3) {
        // Soft random hi-hats for nice groove
        this.playHiHat(now);
      }
    }

    // --- Play Bass ---
    if (bassNote > 0 && this.musicVolume > 0) {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = 0; // Initialize immediately to prevent default gain of 1.0 leaking
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(this.midiToFreq(bassNote), now);

      gainNode.gain.setValueAtTime(0.0, now);
      const bassGain = this.musicStyle === 'D' ? 0.12 : this.musicStyle === 'B' ? 0.07 : this.musicStyle === 'C' ? 0.05 : 0.09;
      const bassDecay = this.musicStyle === 'C' ? durationInSeconds * 0.8 : durationInSeconds;
      gainNode.gain.linearRampToValueAtTime(bassGain * this.musicVolume, now + 0.008); // Smooth 8ms attack
      gainNode.gain.linearRampToValueAtTime(0.0, now + bassDecay); // Smooth linear decay prevents click

      filter.type = 'lowpass';
      const bassCutoff = this.musicStyle === 'B' ? 220 : this.musicStyle === 'C' ? 260 : 350;
      filter.frequency.setValueAtTime(bassCutoff, now);

      osc.connect(gainNode);
      gainNode.connect(filter);
      this.connectToDestination(filter);

      osc.start(now);
      osc.stop(now + bassDecay);
    }

    // --- Play Harmony (Chord Companion / Arpeggio) ---
    if (harmonyNote > 0 && this.musicVolume > 0) {
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = 0; // Initialize immediately to prevent default gain of 1.0 leaking
      const filter = this.ctx.createBiquadFilter();

      const decayMultiplier = this.musicStyle === 'B' ? 2.5 : this.musicStyle === 'C' ? 0.85 : 1.5;
      const duration = durationInSeconds * decayMultiplier;

      if (this.musicStyle === 'C') {
        // Thick detuned 3-oscillator arpeggiator pluck for Euro Trance!
        const detunes = [-12, 0, 12];
        const oscillators: OscillatorNode[] = [];
        detunes.forEach((det) => {
          const sOsc = this.ctx!.createOscillator();
          sOsc.type = 'sawtooth';
          sOsc.frequency.setValueAtTime(this.midiToFreq(harmonyNote), now);
          sOsc.detune.setValueAtTime(det, now);
          sOsc.connect(gainNode);
          oscillators.push(sOsc);
        });

        oscillators.forEach(o => o.start(now));

        gainNode.gain.setValueAtTime(0.0, now);
        const harmonyGain = 0.011; // Lowered from 0.014 to prevent master clipping
        gainNode.gain.linearRampToValueAtTime(harmonyGain * this.musicVolume, now + 0.01);
        gainNode.gain.linearRampToValueAtTime(0.0, now + duration); // Pure linear decay

        filter.type = 'lowpass';
        // Pluck filter envelope sweeps downwards for that punchy trance arpeggio sound
        filter.frequency.setValueAtTime(2200, now);
        filter.frequency.exponentialRampToValueAtTime(450, now + duration - 0.01);
        filter.Q.setValueAtTime(2.5, now);

        gainNode.connect(filter);
        this.connectToDestination(filter);

        oscillators.forEach(o => o.stop(now + duration));
      } else {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(this.midiToFreq(harmonyNote), now);

        gainNode.gain.setValueAtTime(0.0, now);
        const harmonyGain = this.musicStyle === 'B' ? 0.05 : 0.035; // slightly reduced
        
        gainNode.gain.linearRampToValueAtTime(harmonyGain * this.musicVolume, now + 0.02);
        gainNode.gain.linearRampToValueAtTime(0.0, now + duration); // Pure linear decay

        filter.type = 'lowpass';
        const cutoff = this.musicStyle === 'B' ? 500 : 800;
        filter.frequency.setValueAtTime(cutoff, now);

        osc.connect(gainNode);
        gainNode.connect(filter);
        this.connectToDestination(filter);

        osc.start(now);
        osc.stop(now + duration);
      }
    }

    // --- Play Melody ---
    if (melodyNote > 0 && this.musicVolume > 0) {
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = 0; // Initialize immediately to prevent default gain of 1.0 leaking
      const filter = this.ctx.createBiquadFilter();

      if (this.musicStyle === 'C') {
        // Fat, soaring detuned 5-oscillator SUPERSAW Stack!
        // Detuning values spread across the spectrum for authentic chorus/supersaw texture
        const detunes = [-22, -10, 0, 10, 22];
        const oscillators: OscillatorNode[] = [];
        detunes.forEach((det) => {
          const sOsc = this.ctx!.createOscillator();
          sOsc.type = 'sawtooth';
          sOsc.frequency.setValueAtTime(this.midiToFreq(melodyNote), now);
          sOsc.detune.setValueAtTime(det, now);
          sOsc.connect(gainNode);
          oscillators.push(sOsc);
        });

        oscillators.forEach(o => o.start(now));

        gainNode.gain.setValueAtTime(0.0, now);
        const attack = 0.015;
        const decay = durationInSeconds * 1.5;
        // Moderate individual volume so the stacked notes blend nicely
        const melodyGain = 0.018; // Lowered from 0.024 to prevent master clipping

        gainNode.gain.linearRampToValueAtTime(melodyGain * this.musicVolume, now + attack);
        gainNode.gain.linearRampToValueAtTime(0.0, now + decay); // Pure linear decay

        filter.type = 'lowpass';
        // Bright open filter with resonating peaks for trance scream!
        filter.frequency.setValueAtTime(2600, now);
        filter.frequency.exponentialRampToValueAtTime(900, now + decay - 0.01);
        filter.Q.setValueAtTime(3.5, now);

        gainNode.connect(filter);
        this.connectToDestination(filter);

        oscillators.forEach(o => o.stop(now + decay));
      } else {
        const osc = this.ctx.createOscillator();
        // Style specific oscillator types and values
        if (this.musicStyle === 'B') {
          osc.type = 'sine'; // Super warm, soft lofi sound
        } else if (this.musicStyle === 'D') {
          osc.type = 'sawtooth'; // Harsh, futuristic industrial sound
        } else {
          osc.type = 'triangle'; // Retro cyber pluck
        }
        osc.frequency.setValueAtTime(this.midiToFreq(melodyNote), now);

        gainNode.gain.setValueAtTime(0.0, now);
        const attack = this.musicStyle === 'B' ? 0.04 : 0.01;
        const decay = this.musicStyle === 'B' ? durationInSeconds * 2.0 : durationInSeconds;
        const melodyGain = this.musicStyle === 'D' ? 0.06 : this.musicStyle === 'B' ? 0.09 : 0.075; // slightly reduced
        
        gainNode.gain.linearRampToValueAtTime(melodyGain * this.musicVolume, now + attack);
        gainNode.gain.linearRampToValueAtTime(0.0, now + decay); // Pure linear decay

        filter.type = 'lowpass';
        const cutoff = this.musicStyle === 'B' ? 600 : this.musicStyle === 'D' ? 1000 : 1500;
        filter.frequency.setValueAtTime(cutoff, now);

        osc.connect(gainNode);
        gainNode.connect(filter);
        this.connectToDestination(filter);

        osc.start(now);
        osc.stop(now + decay);
      }
    }

    // Advance scheduling step and time
    this.nextNoteTime += durationInSeconds;
    this.currentStep = (this.currentStep + 1) % 32;

    // If we've completed a 32-step phrase, increase count.
    // Every 4 phrases, generate a completely new phrase!
    if (this.currentStep === 0) {
      this.phraseCount++;
      if (this.phraseCount >= 4) {
        this.generatePhrase();
        this.phraseCount = 0;
      }
    }
  }

  private startScheduler() {
    if (this.schedulerActive) return;

    this.initCtx();
    if (!this.ctx) return;

    // Generate our first phrase
    this.generatePhrase();
    this.phraseCount = 0;

    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.currentStep = 0;

    this.schedulerActive = true;

    // Try to start the Web Worker scheduler
    this.initWorker();
    if (this.worker) {
      this.worker.postMessage("start");
    } else {
      // Fallback lookahead loop: runs every 100ms and schedules notes that fall within next 200ms
      const lookahead = 0.2;
      this.schedulerIntervalId = window.setInterval(() => {
        this.handleTick();
      }, 100);
    }
  }

  public startMusic() {
    this.initCtx();
    if (!this.ctx) return;

    if (this.musicEnabled) {
      this.startScheduler();
    }
  }

  public stopMusic() {
    this.schedulerActive = false;
    if (this.schedulerIntervalId) {
      clearInterval(this.schedulerIntervalId);
      this.schedulerIntervalId = null;
    }
    if (this.worker) {
      this.worker.postMessage("stop");
    }
    this.scheduleSuspend();
  }
}

export const audioEngine = new RetroAudioEngine();
