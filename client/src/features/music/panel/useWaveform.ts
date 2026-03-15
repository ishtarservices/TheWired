import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import { getAudio } from "../useAudioPlayer";

const BAR_COUNT = 120;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const TOTAL_BAR_WIDTH = BAR_WIDTH + BAR_GAP;

// Module-level cache to avoid re-decoding the same audio
const waveformCache = new Map<string, Float32Array>();

function downsampleToRMS(channelData: Float32Array, buckets: number): Float32Array {
  const result = new Float32Array(buckets);
  const samplesPerBucket = Math.floor(channelData.length / buckets);
  for (let i = 0; i < buckets; i++) {
    let sum = 0;
    const start = i * samplesPerBucket;
    for (let j = start; j < start + samplesPerBucket; j++) {
      sum += channelData[j] * channelData[j];
    }
    result[i] = Math.sqrt(sum / samplesPerBucket);
  }
  // Normalize to 0-1
  let max = 0;
  for (let i = 0; i < buckets; i++) {
    if (result[i] > max) max = result[i];
  }
  if (max > 0) {
    for (let i = 0; i < buckets; i++) {
      result[i] /= max;
    }
  }
  return result;
}

/** Resolve pulse color from CSS once, cache the result */
function resolvePulseColor(canvas: HTMLCanvasElement): [number, number, number] {
  const style = getComputedStyle(canvas);
  const raw = style.getPropertyValue("--color-pulse").trim();
  if (raw) {
    const tmp = document.createElement("div");
    tmp.style.color = raw;
    document.body.appendChild(tmp);
    const computed = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);
    const m = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return [139, 92, 246]; // violet-500 fallback
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  progress: number,
  activeColor: string,
  dimColor: string,
  dpr: number,
) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  ctx.clearRect(0, 0, width * dpr, height * dpr);

  const bars = Math.min(data.length, Math.floor(width / TOTAL_BAR_WIDTH));
  const offsetX = (width - bars * TOTAL_BAR_WIDTH) / 2;
  const progressBar = progress > 0 ? Math.floor(progress * bars) : -1;

  for (let i = 0; i < bars; i++) {
    const amplitude = data[i] ?? 0;
    const barHeight = Math.max(2, amplitude * (height - 4));
    const x = offsetX + i * TOTAL_BAR_WIDTH;
    const y = (height - barHeight) / 2;

    ctx.fillStyle = i <= progressBar ? activeColor : dimColor;
    ctx.beginPath();
    ctx.roundRect(x, y, BAR_WIDTH, barHeight, 1);
    ctx.fill();
  }
}

export function useWaveform(
  audioUrl: string | null,
  isCurrentTrack: boolean,
  onSeek?: (fraction: number) => void,
): {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  loading: boolean;
  error: string | null;
} {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<Float32Array | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const colorsRef = useRef<{ active: string; dim: string } | null>(null);
  const sizedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set up canvas context and resolve colors once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;

    // Resolve color once
    const [r, g, b] = resolvePulseColor(canvas);
    colorsRef.current = {
      active: `rgba(${r}, ${g}, ${b}, 0.9)`,
      dim: `rgba(${r}, ${g}, ${b}, 0.2)`,
    };

    // Size canvas once (only resize if dimensions changed)
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    sizedRef.current = true;
  }, [loading]); // re-run after loading completes (canvas may have just mounted)

  // Decode audio and extract waveform data
  useEffect(() => {
    if (!audioUrl) {
      dataRef.current = null;
      return;
    }

    const cached = waveformCache.get(audioUrl);
    if (cached) {
      dataRef.current = cached;
      return;
    }

    let cancelled = false;
    let audioCtx: AudioContext | null = null;

    const decode = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw new Error("Failed to fetch audio");
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(buffer);
        if (cancelled) return;

        const channelData = audioBuffer.getChannelData(0);
        const downsampled = downsampleToRMS(channelData, BAR_COUNT);
        waveformCache.set(audioUrl, downsampled);
        dataRef.current = downsampled;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Waveform error");
        }
      } finally {
        if (!cancelled) setLoading(false);
        if (audioCtx) {
          audioCtx.close().catch(() => {});
        }
      }
    };

    decode();
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  // rAF-driven animation loop — reads audio.currentTime directly at 60fps
  // Only redraws when the visible progress bar index changes (no unnecessary work)
  useEffect(() => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    const ctx = ctxRef.current;
    const colors = colorsRef.current;
    if (!canvas || !data || !ctx || !colors) return;

    const dpr = window.devicePixelRatio || 1;

    // Ensure canvas is sized
    if (!sizedRef.current) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      sizedRef.current = true;
    }

    if (!isCurrentTrack) {
      // Static draw with no progress
      drawWaveform(canvas, ctx, data, 0, colors.active, colors.dim, dpr);
      return;
    }

    let rafId: number;
    let lastProgressBar = -2; // sentinel to force first draw

    const animate = () => {
      const audio = getAudio();
      const duration = audio.duration;
      const progress = duration > 0 && isFinite(duration)
        ? audio.currentTime / duration
        : 0;

      const width = canvas.clientWidth;
      const bars = Math.min(data.length, Math.floor(width / TOTAL_BAR_WIDTH));
      const currentBar = progress > 0 ? Math.floor(progress * bars) : -1;

      // Only redraw when the highlighted bar changes
      if (currentBar !== lastProgressBar) {
        lastProgressBar = currentBar;
        drawWaveform(canvas, ctx, data, progress, colors.active, colors.dim, dpr);
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [isCurrentTrack, loading]); // restart loop when track changes or data loads

  // Click-to-seek handler — maps click position to the bar area (not full canvas)
  const handleClick = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      const data = dataRef.current;
      if (!canvas || !onSeek || !data) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const bars = Math.min(data.length, Math.floor(width / TOTAL_BAR_WIDTH));
      const barAreaWidth = bars * TOTAL_BAR_WIDTH;
      const offsetX = (width - barAreaWidth) / 2;
      const fraction = (clickX - offsetX) / barAreaWidth;
      onSeek(Math.max(0, Math.min(1, fraction)));
    },
    [onSeek],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [handleClick]);

  return { canvasRef, loading, error };
}
