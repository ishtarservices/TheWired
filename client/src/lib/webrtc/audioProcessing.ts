/**
 * Local audio analysis helpers.
 */
import { getSharedAudioContext } from "../audio/unlockAudio";

/**
 * Report the RMS level (0..1) of a stream's audio at ~`intervalMs`.
 * Uses the shared, gesture-unlocked AudioContext (a private context created
 * outside a gesture would stay suspended on WebView2 and read all zeros).
 * Returns a cleanup function.
 */
export function createAudioLevelMonitor(
  stream: MediaStream,
  onLevel: (level: number) => void,
  intervalMs = 100,
): () => void {
  const audioContext = getSharedAudioContext();
  if (!audioContext) return () => {};

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Float32Array(analyser.fftSize);
  let rafId = 0;
  let lastUpdate = 0;

  function update() {
    rafId = requestAnimationFrame(update);
    const now = performance.now();
    if (now - lastUpdate < intervalMs) return;
    lastUpdate = now;

    analyser.getFloatTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
    const rms = Math.sqrt(sum / dataArray.length);
    // Speech RMS sits around 0.02–0.2; scale so normal speech lands mid-meter.
    onLevel(Math.min(1, rms * 5));
  }

  update();

  return () => {
    cancelAnimationFrame(rafId);
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      /* already disconnected */
    }
  };
}
