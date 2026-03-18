/**
 * Audio processing utilities for voice channels.
 * Phase 2: Noise suppression via RNNoise WASM.
 */

/**
 * Apply WebRTC built-in noise suppression to a media stream.
 * This uses the browser's built-in AEC, AGC, and noise suppression.
 */
export async function applyBuiltinProcessing(
  stream: MediaStream,
): Promise<MediaStream> {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return stream;

  // Apply constraints for built-in processing
  await audioTrack.applyConstraints({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });

  return stream;
}

/**
 * Create an audio level monitor that reports the current audio level.
 * Returns a cleanup function.
 */
export function createAudioLevelMonitor(
  stream: MediaStream,
  onLevel: (level: number) => void,
  intervalMs = 100,
): () => void {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;

  source.connect(analyser);

  const dataArray = new Float32Array(analyser.fftSize);
  let rafId: number;
  let lastUpdate = 0;

  function update() {
    rafId = requestAnimationFrame(update);

    const now = performance.now();
    if (now - lastUpdate < intervalMs) return;
    lastUpdate = now;

    analyser.getFloatTimeDomainData(dataArray);

    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Normalize to 0-1 range
    const level = Math.min(1, rms * 10);
    onLevel(level);
  }

  update();

  return () => {
    cancelAnimationFrame(rafId);
    source.disconnect();
    audioContext.close();
  };
}
