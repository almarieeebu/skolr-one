"use client";

// Optional drawn signature (finger or mouse). Gives a PNG data URL, or null when cleared.

import { useEffect, useRef, useState } from "react";

export default function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drew = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Match the canvas pixels to its CSS size (sharp lines on phones).
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c2430";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={ref}
        data-testid="ap-signature-pad"
        aria-label="Draw your signature"
        className="h-32 w-full touch-none rounded-lg border border-dashed border-line bg-surface"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d");
          const p = point(e);
          drawing.current = true;
          ctx?.beginPath();
          ctx?.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d");
          const p = point(e);
          ctx?.lineTo(p.x, p.y);
          ctx?.stroke();
          drew.current = true;
          setEmpty(false);
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (drew.current) onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>{empty ? "Optional: sign with your finger." : "Signature drawn."}</span>
        <button
          type="button"
          className="font-medium text-brand underline"
          onClick={() => {
            const c = ref.current;
            c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
            drew.current = false;
            setEmpty(true);
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
