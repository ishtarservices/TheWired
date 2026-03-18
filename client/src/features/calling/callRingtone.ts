/**
 * Audio playback for call sounds (ring, hangup, join/leave).
 *
 * Uses Web Audio API with synthesized tones since we don't have
 * audio files yet. Can be replaced with actual audio files later.
 */

let audioContext: AudioContext | null = null;
let activeOscillator: OscillatorNode | null = null;
let ringInterval: ReturnType<typeof setInterval> | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * Play a ringing sound (repeating tone).
 */
export function startRinging(): void {
  stopRinging();

  const playRingBurst = () => {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 440;
    gain.gain.value = 0.1;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);

    // Second tone (higher)
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = 554;
      gain2.gain.value = 0.1;
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc2.stop(ctx.currentTime + 0.5);
    }, 200);
  };

  playRingBurst();
  ringInterval = setInterval(playRingBurst, 3000);
}

/**
 * Stop the ringing sound.
 */
export function stopRinging(): void {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  if (activeOscillator) {
    try {
      activeOscillator.stop();
    } catch {
      // Already stopped
    }
    activeOscillator = null;
  }
}

/**
 * Play a call-ended sound (descending tone).
 */
export function playCallEnd(): void {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 440;
  osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3);
  gain.gain.value = 0.1;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

/**
 * Play a join sound (ascending tone).
 */
export function playJoinSound(): void {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 330;
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
  gain.gain.value = 0.08;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

/**
 * Play a leave sound (descending tone).
 */
export function playLeaveSound(): void {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 440;
  osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 0.15);
  gain.gain.value = 0.08;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}
