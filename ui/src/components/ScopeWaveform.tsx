import { useEffect, useRef } from "react";
import { bridge } from "../bridge";
import "./ScopeWaveform.css";

const RING = 300; // decimated samples across the visible chain (~0.25s live window)

// A live oscilloscope of the signal, scrolling left (input) -> right (output).
// New samples enter at the left and flow rightward, so a pick attack visibly
// travels down the chain. Driven by real decimated samples from the engine;
// flat when there's no input.
export function ScopeWaveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ring = useRef(new Float32Array(RING));
  const head = useRef(0);

  useEffect(() => {
    return bridge.subscribeScope((samples) => {
      const r = ring.current;
      for (let i = 0; i < samples.length; i++) {
        r[head.current] = samples[i];
        head.current = (head.current + 1) % RING;
      }
    });
  }, []);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const mid = h / 2;
      const amp = h * 0.42;
      const r = ring.current;
      const hd = head.current;

      // build the path: x=0 (left) = newest sample, increasing x = older
      const path = new Path2D();
      let energy = 0;
      for (let x = 0; x <= w; x++) {
        const frac = x / w;
        const idx = (hd - 1 - Math.floor(frac * (RING - 1)) + RING * 2) % RING;
        const v = r[idx];
        // perceptual compression: keep quiet/decayed signal visible across the chain
        const cv = Math.sign(v) * Math.pow(Math.abs(v), 0.5);
        energy += Math.abs(cv);
        const y = mid - cv * amp;
        if (x === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      const lively = Math.min(1, (energy / w) * 7); // 0 (silent) .. 1 (loud)

      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // always-visible full-width cable so the chain reads as connected end-to-end
      ctx.shadowColor = "rgba(63,155,240,0.55)";
      ctx.shadowBlur = 3 + 6 * lively;
      ctx.strokeStyle = `rgba(63,155,240,${0.38 + 0.32 * lively})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

      // the live waveform riding on the cable: glow pass + crisp pass
      ctx.shadowBlur = 7 + 12 * lively;
      ctx.strokeStyle = `rgba(109,184,255,${0.6 + 0.4 * lively})`;
      ctx.lineWidth = 2;
      ctx.stroke(path);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(210,232,255,${0.35 + 0.6 * lively})`;
      ctx.lineWidth = 1;
      ctx.stroke(path);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="scope" aria-hidden />;
}
