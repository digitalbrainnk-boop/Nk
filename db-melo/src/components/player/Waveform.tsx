"use client";

import { useEffect, useRef } from "react";

/** Forme d'onde cliquable : la partie écoutée est dorée. Accessible au clavier (flèches). */
export function Waveform({
  peaks,
  progress,
  duration,
  onSeek,
}: {
  peaks: number[] | null;
  progress: number;
  duration: number;
  onSeek: (ratio: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = canvas.current;
    const b = box.current;
    if (!c || !b) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = b.clientWidth;
      const h = b.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const bars = peaks ?? Array.from({ length: 64 }, (_, i) => 0.2 + 0.15 * Math.sin(i / 3) ** 2);
      const slot = w / bars.length;
      const barW = Math.max(1.5, slot * 0.58);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#F3C969");
      grad.addColorStop(1, "#E5A93C");
      bars.forEach((v, i) => {
        const bh = Math.max(3, v * (h - 6));
        const x = i * slot + (slot - barW) / 2;
        ctx.fillStyle = (i + 0.5) / bars.length <= progress ? grad : peaks ? "#3A3A52" : "#26263a";
        ctx.beginPath();
        ctx.roundRect(x, (h - bh) / 2, barW, bh, barW / 2);
        ctx.fill();
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(b);
    return () => ro.disconnect();
  }, [peaks, progress]);

  const seekFromEvent = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label="Position de lecture"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(progress * duration)}
      className="relative h-16 w-full cursor-pointer touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        seekFromEvent(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e.clientX)}
      onKeyDown={(e) => {
        const step = duration ? 5 / duration : 0.05;
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + step));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - step));
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}
