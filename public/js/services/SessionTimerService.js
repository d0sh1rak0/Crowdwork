/**
 * Silence Sentinel — counts seconds since the last non-empty Whisper chunk.
 * Independent of MediaRecorder chunk cadence so dead air still mutates the room.
 */
class SessionTimerService {
  constructor() {
    this.silenceDuration = 0;
    this.timerInterval = null;
    this.maxSilenceThreshold = 6;
    this.hesitationThreshold = 4;
    this._onTick = null;
    this._criticalFired = false;
    this._hesitationFired = false;
  }

  startTracking(onSilenceThresholdMet, onTick) {
    this.stopTracking();
    this.silenceDuration = 0;
    this._criticalFired = false;
    this._hesitationFired = false;
    this._onTick = onTick || null;

    this.timerInterval = setInterval(() => {
      this.silenceDuration += 1;

      if (this._onTick) {
        this._onTick(this.silenceDuration, {
          hesitation:
            this.silenceDuration >= this.hesitationThreshold &&
            this.silenceDuration < this.maxSilenceThreshold,
          critical: this.silenceDuration >= this.maxSilenceThreshold,
        });
      }

      if (
        this.silenceDuration >= this.hesitationThreshold &&
        !this._hesitationFired
      ) {
        this._hesitationFired = true;
      }

      if (
        this.silenceDuration >= this.maxSilenceThreshold &&
        !this._criticalFired
      ) {
        this._criticalFired = true;
        onSilenceThresholdMet?.(this.silenceDuration);
      }
    }, 1000);
  }

  /** Call the exact moment a valid non-empty text word returns from Groq Whisper. */
  resetSilenceCounter() {
    this.silenceDuration = 0;
    this._criticalFired = false;
    this._hesitationFired = false;
  }

  getSilenceDuration() {
    return this.silenceDuration;
  }

  stopTracking() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}

const sessionTimerService = new SessionTimerService();
export default sessionTimerService;
export { SessionTimerService };
