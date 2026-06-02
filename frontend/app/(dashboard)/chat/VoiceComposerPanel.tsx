"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase, getStoredToken } from "@/components/auth/auth-context";
import { showDashboardToast } from "@/components/DashboardToastHost";

const BAR_W = 3;
const GAP = 1.5;
const SLOT = BAR_W + GAP;
const CANVAS_H = 48;
/** Higher = slower horizontal scroll (one new column every N frames). */
const SCROLL_EVERY_FRAMES = 4;
/** RMS below this (after mic calibration) is treated as silence , stricter idle line. */
const RMS_NOISE_FLOOR = 0.018;
/** RMS at or above this maps to full bar height (tune for “how loud” = max). */
const RMS_SPEECH_CEIL = 0.11;

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Props = {
  onClose: () => void;
  onTranscript: (text: string) => void;
};

export function VoiceComposerPanel({ onClose, onTranscript }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>([]);
  const scrollFrameRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timeDataRef = useRef<Uint8Array | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});

  const [seconds, setSeconds] = useState(0);
  const [status, setStatus] = useState("Requesting microphone…");
  const [phase, setPhase] = useState<"recording" | "uploading" | "error">("recording");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const cleanupAudio = useCallback(() => {
    if (animRef.current != null) cancelAnimationFrame(animRef.current);
    animRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    analyserRef.current = null;
    timeDataRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const getLevel = useCallback(() => {
    const analyser = analyserRef.current;
    const td = timeDataRef.current;
    if (!analyser || !td) return 0;
    analyser.getByteTimeDomainData(td as Uint8Array<ArrayBuffer>);
    let sumSq = 0;
    for (let i = 0; i < td.length; i++) {
      const z = (td[i] - 128) / 128;
      sumSq += z * z;
    }
    const rms = Math.sqrt(sumSq / td.length);
    if (rms < RMS_NOISE_FLOOR) return 0;
    const span = Math.max(1e-6, RMS_SPEECH_CEIL - RMS_NOISE_FLOOR);
    let t = (rms - RMS_NOISE_FLOOR) / span;
    t = Math.max(0, Math.min(1, t));
    // Slight expansion so normal talking reads stronger without flattening peaks.
    return Math.min(1, Math.pow(t, 0.78));
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const bars = barsRef.current;
    const level = getLevel();
    if (bars.length) {
      scrollFrameRef.current += 1;
      if (scrollFrameRef.current >= SCROLL_EVERY_FRAMES) {
        scrollFrameRef.current = 0;
        bars.shift();
        bars.push(level);
      } else {
        bars[bars.length - 1] = level;
      }
    }
    ctx.clearRect(0, 0, w, CANVAS_H);
    for (let i = 0; i < bars.length; i++) {
      const x = i * SLOT;
      const barH = Math.max(2, bars[i] * (CANVAS_H - 4));
      const y = (CANVAS_H - barH) / 2;
      const alpha = 0.3 + (i / Math.max(1, bars.length)) * 0.7;
      ctx.fillStyle = `rgba(37,99,235,${alpha.toFixed(2)})`;
      ctx.fillRect(x, y, BAR_W, barH);
    }
    animRef.current = requestAnimationFrame(() => drawRef.current());
  }, [getLevel]);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const initBars = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const w = parent ? Math.max(120, parent.clientWidth - 72) : 400;
    canvas.width = w;
    const count = Math.floor(canvas.width / SLOT);
    barsRef.current = new Array(count).fill(0);
    scrollFrameRef.current = 0;
  }, []);

  const uploadBlob = useCallback(
    async (blob: Blob) => {
      setPhase("uploading");
      setStatus("Transcribing…");
      const token = getStoredToken();
      if (!token) {
        setPhase("error");
        setErrorDetail("Not signed in");
        setStatus("Could not transcribe");
        return;
      }
      const fd = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      fd.append("file", blob, `recording.${ext}`);
      const res = await fetch(`${getApiBase()}/team/transcribe-audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        let msg = "Transcription failed";
        try {
          const data = (await res.json()) as { detail?: string };
          if (data.detail) msg = data.detail;
        } catch {
          /* ignore */
        }
        setPhase("error");
        setErrorDetail(msg);
        setStatus("Could not transcribe");
        return;
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text || "").trim();
      if (text) {
        onTranscript(text);
        showDashboardToast("Added to message");
      } else {
        showDashboardToast("No speech detected");
      }
      onClose();
    },
    [onClose, onTranscript]
  );

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      cleanupAudio();
      onClose();
      return;
    }
    rec.onstop = () => {
      cleanupAudio();
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      chunksRef.current = [];
      void uploadBlob(blob);
    };
    try {
      rec.stop();
    } catch {
      cleanupAudio();
      onClose();
    }
  }, [cleanupAudio, onClose, uploadBlob]);

  const handleCancel = useCallback(() => {
    if (phase === "uploading") return;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = () => {
        chunksRef.current = [];
        cleanupAudio();
        onClose();
      };
      try {
        rec.stop();
      } catch {
        cleanupAudio();
        onClose();
      }
    } else {
      cleanupAudio();
      onClose();
    }
  }, [cleanupAudio, onClose, phase]);

  useEffect(() => {
    let cancelled = false;
    chunksRef.current = [];

    async function start() {
      initBars();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        setStatus("Microphone unavailable");
        setPhase("error");
        setErrorDetail(e instanceof Error ? e.message : "Mic error");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        await audioCtx.resume();
        if (cancelled) {
          void audioCtx.close();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.45;
        timeDataRef.current = new Uint8Array(analyser.fftSize);
        analyserRef.current = analyser;
        source.connect(analyser);
        setStatus("");
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setStatus("Could not start audio");
        setPhase("error");
        setErrorDetail(e instanceof Error ? e.message : "Audio error");
        return;
      }

      secondsRef.current = 0;
      setSeconds(0);
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);

      draw();

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined;
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.start(250);
    }

    void start();

    return () => {
      cancelled = true;
      cleanupAudio();
    };
  }, [cleanupAudio, draw, initBars]);

  useEffect(() => {
    function onResize() {
      initBars();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [initBars]);

  return (
    <div
      className="flex min-h-[5.25rem] w-full flex-col justify-center gap-2 px-3 py-2.5"
      role="region"
      aria-label="Voice recording"
    >
      <div className="flex min-h-[48px] items-center gap-3 rounded-full border border-[var(--line-strong)] bg-[var(--bg-sunken)] px-3 py-1.5">
        <canvas ref={canvasRef} height={CANVAS_H} className="block min-h-[48px] min-w-0 flex-1" aria-hidden />
        <span className="ari-num shrink-0 text-[13px] font-semibold text-slate-600">{formatTime(seconds)}</span>
      </div>
      {status ? (
        <p className="text-center text-[12px] font-semibold text-slate-600">{status}</p>
      ) : null}
      {errorDetail && phase === "error" ? (
        <p className="text-center text-[11px] font-semibold text-red-600">{errorDetail}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {phase === "recording" ? (
          <button
            type="button"
            onClick={() => stopRecording()}
            className="inline-flex h-8 min-w-[100px] items-center justify-center rounded-[6px] border border-black/10 bg-[var(--accent)] px-3 text-[12px] font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]"
          >
            Stop & transcribe
          </button>
        ) : null}
        {phase === "uploading" ? (
          <span className="text-[12px] font-semibold text-slate-500">Working…</span>
        ) : null}
        <button
          type="button"
          onClick={() => handleCancel()}
          disabled={phase === "uploading"}
          className="inline-flex h-8 min-w-[88px] items-center justify-center rounded-[6px] border border-[var(--line-strong)] bg-white px-3 text-[12px] font-bold text-neutral-950 shadow-none transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
