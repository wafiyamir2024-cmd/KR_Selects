/** Gesture-gated character announcements and short, quiet interface tones. */
export class SelectionAudio {
  constructor({ onStateChange } = {}) {
    this._enabled = true;
    this._unlocked = false;
    this._destroyed = false;
    this._onStateChange = typeof onStateChange === 'function' ? onStateChange : null;
    this._speech = globalThis.speechSynthesis ?? null;
    this._Utterance = globalThis.SpeechSynthesisUtterance ?? null;
    this._context = null;
    this._voices = [];
    this._timer = null;
    this._utterance = null;
    this._lastName = '';
    this._error = null;
    this._nodes = new Set();

    this._refreshVoices = () => {
      try {
        this._voices = this._speech?.getVoices() ?? [];
      } catch {
        this._voices = [];
      }
      this._notify();
    };
    this._onVisibility = () => {
      if (globalThis.document?.hidden) {
        this.cancel();
        this._context?.suspend().catch(() => {});
      }
    };

    this._speech?.addEventListener?.('voiceschanged', this._refreshVoices);
    globalThis.document?.addEventListener('visibilitychange', this._onVisibility);
    this._refreshVoices();
  }

  get enabled() {
    return this._enabled;
  }

  get supported() {
    return Boolean(this._speech && this._Utterance);
  }

  /** Call directly inside a pointer/key gesture; selections work immediately. */
  unlock() {
    if (this._destroyed || !this._enabled) return Promise.resolve(false);
    this._unlocked = true;
    this._error = null;
    this._notify();

    try {
      if (!this._context) {
        const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (AudioContext) this._context = new AudioContext();
      }
      if (this._context?.state === 'suspended') {
        return this._context.resume().then(() => true, () => true);
      }
    } catch {
      // Speech remains useful when Web Audio is unavailable or denied.
    }
    return Promise.resolve(true);
  }

  setEnabled(enabled) {
    if (this._destroyed) return;
    this._enabled = Boolean(enabled);
    if (!this._enabled) {
      this.cancel();
      this._context?.suspend().catch(() => {});
    }
    this._notify();
  }

  /** Pass the normalized voiceName (P, falling back to Name). */
  select(name, { immediate = false } = {}) {
    if (!this._canPlay()) return;
    const spokenName = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!spokenName || (!immediate && spokenName === this._lastName)) return;

    this._stopSpeech();
    this._lastName = spokenName;
    this._tone([520, 780], 0.065, 0.018);
    if (!this.supported) return;

    if (immediate) {
      this._speak(spokenName);
    } else {
      this._timer = globalThis.setTimeout(() => {
        this._timer = null;
        this._speak(spokenName);
      }, 180);
    }
  }

  confirm() {
    if (this._canPlay()) this._tone([392, 587.33, 783.99], 0.19, 0.03);
  }

  cancel() {
    this._stopSpeech();
    this._lastName = '';
    for (const oscillator of this._nodes) {
      try { oscillator.stop(); } catch { /* Already ended. */ }
    }
    this._nodes.clear();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.cancel();
    this._speech?.removeEventListener?.('voiceschanged', this._refreshVoices);
    globalThis.document?.removeEventListener('visibilitychange', this._onVisibility);
    this._context?.close().catch(() => {});
    this._context = null;
    this._onStateChange = null;
  }

  _canPlay() {
    return !this._destroyed && this._enabled && this._unlocked && !globalThis.document?.hidden;
  }

  _notify() {
    try {
      this._onStateChange?.({
        enabled: this.enabled,
        supported: this.supported,
        unlocked: this._unlocked,
        voicesReady: this._voices.length > 0,
        error: this._error,
      });
    } catch {
      // A UI callback must not interrupt selection or audio cleanup.
    }
  }

  _stopSpeech() {
    if (this._timer !== null) globalThis.clearTimeout(this._timer);
    this._timer = null;
    const active = this._utterance;
    this._utterance = null;
    if (active) {
      active.onend = null;
      active.onerror = null;
      try { this._speech?.cancel(); } catch { /* Unavailable speech engine. */ }
    }
  }

  _voice() {
    const score = (voice) => {
      let value = /^en(?:[-_]|$)/i.test(voice.lang) ? 100 : 0;
      if (/natural|neural|premium|enhanced/i.test(voice.name)) value += 40;
      if (/google|samantha|daniel|aria|jenny/i.test(voice.name)) value += 15;
      if (voice.default) value += 5;
      if (voice.localService) value += 1;
      return value;
    };
    return this._voices.reduce((best, voice) => !best || score(voice) > score(best) ? voice : best, null);
  }

  _speak(name) {
    if (!this._canPlay() || !this.supported) return;
    try {
      const utterance = new this._Utterance(name);
      const voice = this._voice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US';
      utterance.rate = 0.88;
      utterance.pitch = 0.9;
      utterance.volume = 0.85;
      this._utterance = utterance;
      utterance.onend = () => {
        if (this._utterance === utterance) this._utterance = null;
      };
      utterance.onerror = (event) => {
        if (this._utterance !== utterance) return;
        this._utterance = null;
        if (event.error === 'canceled' || event.error === 'interrupted') return;
        this._error = event.error || 'speech-unavailable';
        this._lastName = '';
        if (event.error === 'not-allowed') this._unlocked = false;
        this._notify();
      };
      this._speech.speak(utterance);
    } catch {
      this._utterance = null;
      this._lastName = '';
      this._error = 'speech-unavailable';
      this._notify();
    }
  }

  _tone(frequencies, duration, volume) {
    const context = this._context;
    if (!context || context.state !== 'running') return;
    try {
      const now = context.currentTime;
      frequencies.forEach((frequency, index) => {
        const start = now + index * 0.025;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        this._nodes.add(oscillator);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          this._nodes.delete(oscillator);
        };
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
      });
    } catch {
      // Interface audio is optional; it must never block user input.
    }
  }
}
