/**
 * Romantic Audio Controller with Instant Toggle & Zero UI Blocking
 * - Instant (<5ms) play/pause toggle response
 * - Respects manual user pause so background listeners never unexpectedly restart music
 * - Lightweight loop volume management without 50ms timer overhead
 */
class RomanticAudio {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private userPaused = false;
  private timer: number | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private volume = 0.9;
  private listeners: ((isPlaying: boolean) => void)[] = [];
  private fadeInterval: number | null = null;
  private pendingGestureUrl: string | null = null;
  private hasGestureListener = false;

  private readonly FADE_DURATION_SECONDS = 2.0;

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
      this.audioEl.preload = 'metadata';
      this.audioEl.volume = this.volume;

      this.audioEl.addEventListener('play', () => {
        this.isPlaying = true;
        this.startFadeTicker();
        this.notifyListeners(true);
      });

      this.audioEl.addEventListener('pause', () => {
        this.isPlaying = false;
        this.stopFadeTicker();
        this.notifyListeners(false);
      });

      this.audioEl.addEventListener('ended', () => {
        if (this.isPlaying && this.audioEl) {
          this.audioEl.currentTime = 0;
          this.audioEl.play().catch(() => {});
        }
      });

      this.audioEl.addEventListener('error', () => {
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
      if (this.currentUrl !== musicUrl) {
        const wasPlaying = this.isPlaying && !el.paused;
        this.currentUrl = musicUrl;
        el.src = musicUrl;
        if (wasPlaying) {
          el.play().catch(() => {});
        }
      }
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public isUserPaused(): boolean {
    return this.userPaused;
  }

  public resumeContext() {
    try {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
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
    if (this.audioEl) {
      this.audioEl.volume = this.volume;
    }
  }

  private startFadeTicker() {
    this.stopFadeTicker();
    this.fadeInterval = window.setInterval(() => {
      this.updateLoopFadeVolume();
    }, 300);
  }

  private stopFadeTicker() {
    if (this.fadeInterval !== null) {
      window.clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
  }

  private updateLoopFadeVolume() {
    if (!this.audioEl || !this.isPlaying) return;

    const duration = this.audioEl.duration;
    const current = this.audioEl.currentTime;

    if (!duration || isNaN(duration) || duration <= this.FADE_DURATION_SECONDS * 2) {
      this.audioEl.volume = this.volume;
      return;
    }

    const fadeWindow = this.FADE_DURATION_SECONDS;
    const timeLeft = duration - current;
    let gain = 1.0;

    if (timeLeft <= fadeWindow && timeLeft >= 0) {
      gain = Math.max(0.15, timeLeft / fadeWindow);
    }

    this.audioEl.volume = Math.max(0, Math.min(1, this.volume * gain));
  }

  private setupGestureUnlock(musicUrl: string) {
    if (this.userPaused) return;
    this.pendingGestureUrl = musicUrl;
    if (this.hasGestureListener) return;
    this.hasGestureListener = true;

    const onUserGesture = () => {
      this.hasGestureListener = false;
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
      if (this.userPaused) return;
      const target = this.pendingGestureUrl || this.currentUrl;
      if (target && !this.isPlaying) {
        this.play(target);
      }
    };

    window.addEventListener('pointerdown', onUserGesture, { once: true, passive: true });
    window.addEventListener('keydown', onUserGesture, { once: true, passive: true });
  }

  public playTrack(musicUrl: string, forceByUser = false) {
    if (!musicUrl || musicUrl.trim().length === 0) return;
    if (this.userPaused && !forceByUser) return;

    this.userPaused = false;
    const el = this.ensureAudioElement();

    if (this.isPlaying && this.currentUrl === musicUrl && !el.paused) {
      return;
    }

    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    if (this.currentUrl !== musicUrl || !el.src || el.src === '') {
      el.src = musicUrl;
      this.currentUrl = musicUrl;
    }

    el.loop = true;
    el.volume = this.volume;

    // Optimistic UI notification so toggle button flips immediately on click
    this.isPlaying = true;
    this.notifyListeners(true);

    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.isPlaying = true;
          this.startFadeTicker();
          this.notifyListeners(true);
        })
        .catch(() => {
          this.isPlaying = false;
          this.notifyListeners(false);
          this.setupGestureUnlock(musicUrl);
        });
    } else {
      this.startFadeTicker();
    }
  }

  public play(musicUrl?: string, forceByUser = false) {
    if (musicUrl && musicUrl.trim().length > 0) {
      this.playTrack(musicUrl, forceByUser);
      return;
    }

    if (this.currentUrl) {
      this.playTrack(this.currentUrl, forceByUser);
    } else {
      this.playSynth();
    }
  }

  public toggle(musicUrl?: string): boolean {
    if (this.isPlaying) {
      this.userPaused = true;
      this.stop(false);
      return false;
    } else {
      this.userPaused = false;
      const urlToPlay = musicUrl || this.currentUrl;
      if (urlToPlay) {
        this.play(urlToPlay, true);
      } else {
        this.playSynth();
      }
      return true;
    }
  }

  public stop(_smooth = false) {
    this.isPlaying = false;
    this.notifyListeners(false);
    this.stopFadeTicker();

    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    if (this.audioEl) {
      try {
        this.audioEl.pause();
      } catch {}
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

      const notes = [
        220.0, 261.63, 329.63, 440.0, 392.0, 349.23, 329.63, 293.66, 261.63, 246.94, 220.0, 196.0,
        174.61, 220.0, 246.94, 220.0,
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

  public playChime() {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = this.ctx || new AudioCtx();
      this.ctx = ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + idx * 0.07);

        gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + idx * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.07 + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.07);
        osc.stop(ctx.currentTime + idx * 0.07 + 0.5);
      });
    } catch {
      // Ignore audio errors gracefully
    }
  }

  public fadeVolumeTo(target: number, durationMs: number = 600) {
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
