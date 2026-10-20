/**
 * Romantic Audio Controller with HTML5 Audio and Web Audio Fallback
 * - Supports custom music tracks with seamless playback
 * - 3-second smooth fade-in and fade-out on loop transitions
 * - Volume set to 0.9 (10% reduced for gentle listening)
 * - Automatic user-gesture recovery if browser blocks autoplay
 * - Event subscriber system to keep UI play/pause badges perfectly synchronized
 */
class RomanticAudio {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private timer: number | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private volume = 0.9; // 10% lower than maximum for soft romantic listening
  private listeners: ((isPlaying: boolean) => void)[] = [];
  private fadeInterval: number | null = null;
  private isFadingOutToStop = false;
  private pendingGestureUrl: string | null = null;
  private hasGestureListener = false;

  // 2 seconds fade effect requested by user for loop transition
  private readonly FADE_DURATION_SECONDS = 2.0;

  constructor() {
    // Lazy setup when browser is available
  }

  public subscribe(fn: (isPlaying: boolean) => void): () => void {
    this.listeners.push(fn);
    fn(this.isPlaying);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notifyListeners(playing: boolean) {
    this.listeners.forEach((fn) => {
      try {
        fn(playing);
      } catch (err) {
        console.error('Audio listener error:', err);
      }
    });
  }

  private ensureAudioElement(): HTMLAudioElement {
    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.loop = true;
      this.audioEl.preload = 'auto';
      this.audioEl.volume = 0; // Starts at 0, faded in smoothly by ticker

      // Keep isPlaying and UI in sync with native audio events
      this.audioEl.addEventListener('play', () => {
        this.isPlaying = true;
        this.startFadeTicker();
        this.notifyListeners(true);
      });

      this.audioEl.addEventListener('pause', () => {
        if (!this.isFadingOutToStop) {
          this.isPlaying = false;
          this.stopFadeTicker();
          this.notifyListeners(false);
        }
      });

      this.audioEl.addEventListener('ended', () => {
        // Fallback for browsers that don't auto-loop
        if (this.isPlaying && this.audioEl) {
          this.audioEl.currentTime = 0;
          this.audioEl.play().catch(() => {});
        }
      });

      this.audioEl.addEventListener('error', (e) => {
        console.warn('Audio element error:', e);
        // If external audio fails, try synth fallback
        if (this.isPlaying) {
          this.playSynth();
        }
      });
    }
    return this.audioEl;
  }

  public init(musicUrl?: string) {
    if (musicUrl && musicUrl.trim().length > 0) {
      const el = this.ensureAudioElement();
      if (!this.currentUrl) {
        this.currentUrl = musicUrl;
        el.src = musicUrl;
      }
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public resumeContext() {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx && AudioCtx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.audioEl && this.currentUrl && !this.isPlaying) {
        this.audioEl.load();
      }
    } catch {
      // Ignore browser restrictions
    }
  }

  public getCurrentUrl(): string | null {
    return this.currentUrl;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.audioEl && !this.isFadingOutToStop) {
      this.updateLoopFadeVolume();
    }
  }

  /**
   * 2-Second Fade Ticker:
   * Smoothly fades out in the final 2 seconds before loop end,
   * and smoothly fades in during the first 2 seconds after loop start.
   */
  private startFadeTicker() {
    this.stopFadeTicker();
    this.fadeInterval = window.setInterval(() => {
      this.updateLoopFadeVolume();
    }, 50); // 20 updates per second for silky smooth fading
  }

  private stopFadeTicker() {
    if (this.fadeInterval !== null) {
      window.clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
  }

  private updateLoopFadeVolume() {
    if (!this.audioEl || !this.isPlaying || this.isFadingOutToStop) return;

    const duration = this.audioEl.duration;
    const current = this.audioEl.currentTime;

    // If duration not loaded or too short, play at target volume
    if (!duration || isNaN(duration) || duration <= this.FADE_DURATION_SECONDS * 2) {
      this.audioEl.volume = this.volume;
      return;
    }

    const fadeWindow = this.FADE_DURATION_SECONDS; // 3 seconds
    const timeLeft = duration - current;
    let gain = 1.0;

    if (timeLeft <= fadeWindow && timeLeft >= 0) {
      // 3-second Fade Out when approaching the loop transition
      gain = Math.max(0.01, timeLeft / fadeWindow);
    } else if (current <= fadeWindow && current >= 0) {
      // 3-second Fade In right after loop begins
      gain = Math.min(1.0, Math.max(0.01, current / fadeWindow));
    } else {
      // Full volume during main playback
      gain = 1.0;
    }

    const calculatedVol = Math.max(0, Math.min(1, this.volume * gain));
    this.audioEl.volume = calculatedVol;
  }

  /**
   * Recovers audio playback if browser blocked autoplay before user clicked
   */
  private setupGestureUnlock(musicUrl: string) {
    this.pendingGestureUrl = musicUrl;
    if (this.hasGestureListener) return;
    this.hasGestureListener = true;

    const onUserGesture = () => {
      this.hasGestureListener = false;
      const target = this.pendingGestureUrl || this.currentUrl;
      if (target) {
        this.play(target);
      }
    };

    const events = ['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'];
    events.forEach((evt) => {
      window.addEventListener(evt, onUserGesture, { once: true, passive: true });
    });
  }

  public playTrack(musicUrl: string) {
    if (!musicUrl || musicUrl.trim().length === 0) return;

    const el = this.ensureAudioElement();

    // If already playing this exact track and audio is unpaused, do nothing
    if (this.isPlaying && this.currentUrl === musicUrl && !el.paused) {
      return;
    }

    // Stop synthesizer if running
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    this.isFadingOutToStop = false;

    if (this.currentUrl !== musicUrl || !el.src || el.src === '') {
      el.src = musicUrl;
      this.currentUrl = musicUrl;
    }

    el.loop = true;

    // Start with 0 volume and let the 3s fade in handle it softly
    if (el.currentTime <= this.FADE_DURATION_SECONDS) {
      el.volume = Math.max(0.01, (el.currentTime / this.FADE_DURATION_SECONDS) * this.volume);
    } else {
      el.volume = this.volume;
    }

    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.isPlaying = true;
          this.startFadeTicker();
          this.notifyListeners(true);
        })
        .catch((err) => {
          console.warn('Autoplay restricted by browser, waiting for user gesture:', err);
          this.isPlaying = false;
          this.notifyListeners(false);
          this.setupGestureUnlock(musicUrl);
        });
    } else {
      this.isPlaying = true;
      this.startFadeTicker();
      this.notifyListeners(true);
    }
  }

  public play(musicUrl?: string) {
    if (musicUrl && musicUrl.trim().length > 0) {
      this.playTrack(musicUrl);
      return;
    }

    if (this.currentUrl) {
      this.playTrack(this.currentUrl);
    } else {
      this.playSynth();
    }
  }

  public toggle(musicUrl?: string): boolean {
    if (this.isPlaying) {
      this.stop();
      return false;
    } else {
      const urlToPlay = musicUrl || this.currentUrl;
      if (urlToPlay) {
        this.play(urlToPlay);
      } else {
        this.playSynth();
      }
      return true;
    }
  }

  public stop(smooth = true) {
    if (!this.isPlaying && !this.audioEl) return;

    this.isPlaying = false;
    this.notifyListeners(false);
    this.stopFadeTicker();

    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    if (this.audioEl) {
      if (smooth && this.audioEl.volume > 0.05) {
        this.isFadingOutToStop = true;
        const initialVol = this.audioEl.volume;
        const start = performance.now();
        const fadeDuration = 350; // 350ms gentle fade out

        const fadeOutStep = (now: number) => {
          const elapsed = now - start;
          const progress = Math.min(1, elapsed / fadeDuration);
          if (this.audioEl) {
            this.audioEl.volume = Math.max(0, initialVol * (1 - progress));
            if (progress < 1 && this.isFadingOutToStop) {
              requestAnimationFrame(fadeOutStep);
            } else {
              this.audioEl.pause();
              this.isFadingOutToStop = false;
            }
          }
        };
        requestAnimationFrame(fadeOutStep);
      } else {
        this.audioEl.pause();
      }
    }
  }

  private playSynth() {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      this.isPlaying = true;
      this.notifyListeners(true);

      // Deeply emotional & sad piano melody in A minor
      const notes = [
        220.0, 261.63, 329.63, 440.0, 392.0, 349.23, 329.63, 293.66, 261.63, 246.94, 220.0, 196.0,
        174.61, 220.0, 246.94, 220.0, 220.0, 261.63, 349.23, 329.63, 293.66, 261.63, 246.94,
        220.0,
      ];

      let noteIdx = 0;
      const playNextTone = () => {
        if (!this.isPlaying || !this.ctx) return;
        const freq = notes[noteIdx % notes.length];
        noteIdx++;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        const peakVolume = 0.08 * this.volume;

        gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(peakVolume, this.ctx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 1.8);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 1.9);
      };

      playNextTone();
      this.timer = window.setInterval(playNextTone, 650);
    } catch {
      this.isPlaying = false;
      this.notifyListeners(false);
    }
  }

  // Sweet chime sound effect for interactions
  public playChime() {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = this.ctx || new AudioCtx();
      this.ctx = ctx;
      if (ctx.state === 'suspended') ctx.resume();

      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.08 + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.65);
      });
    } catch {
      // Ignore audio errors gracefully
    }
  }

  /**
   * Smoothly fades volume to a target over duration
   */
  public fadeVolumeTo(target: number, durationMs: number = 1000) {
    if (!this.audioEl) return;
    
    const startVol = this.audioEl.volume;
    const startTime = performance.now();
    
    const fade = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      
      if (this.audioEl) {
        this.audioEl.volume = startVol + (target - startVol) * progress;
        if (progress < 1) {
          requestAnimationFrame(fade);
        }
      }
    };
    
    requestAnimationFrame(fade);
  }
}

export const romanticAudio = new RomanticAudio();
