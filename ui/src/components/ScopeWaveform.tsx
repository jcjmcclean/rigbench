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
    const draw = (ts: number) => {
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

      // sample the ring across the width (x=0 left = newest, increasing x = older)
      const ys = new Float32Array(w + 1);
      const path = new Path2D();
      let energy = 0;
      for (let x = 0; x <= w; x++) {
        const frac = x / w;
        const idx = (hd - 1 - Math.floor(frac * (RING - 1)) + RING * 2) % RING;
        const v = r[idx];
        const cv = Math.sign(v) * Math.pow(Math.abs(v), 0.5); // perceptual compression
        energy += Math.abs(cv);
        const y = mid - cv * amp;
        ys[x] = y;
        if (x === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      const lively = Math.min(1, (energy / w) * 7); // 0 (silent) .. 1 (loud)

      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // 1) filled glow area between the curve and the mid-line
      const fill = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
      fill.addColorStop(0, "rgba(63,155,240,0)");
      fill.addColorStop(0.5, `rgba(90,175,255,${0.08 + 0.2 * lively})`);
      fill.addColorStop(1, "rgba(63,155,240,0)");
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let x = 0; x <= w; x++) ctx.lineTo(x, ys[x]);
      ctx.lineTo(w, mid);
      ctx.closePath();
      ctx.fill();

      // 2) always-visible full-width cable
      ctx.shadowColor = "rgba(63,155,240,0.55)";
      ctx.shadowBlur = 3 + 5 * lively;
      ctx.strokeStyle = `rgba(63,155,240,${0.35 + 0.3 * lively})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

      // 3) the live waveform: glow pass + crisp pass
      ctx.shadowBlur = 7 + 12 * lively;
      ctx.strokeStyle = `rgba(109,184,255,${0.6 + 0.4 * lively})`;
      ctx.lineWidth = 2;
      ctx.stroke(path);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(214,234,255,${0.35 + 0.6 * lively})`;
      ctx.lineWidth = 1;
      ctx.stroke(path);

      // 4) a highlight "packet" flowing left -> right along the cable (signal direction)
      const flowX = ((ts / 1300) % 1) * w;
      const fx = ctx.createRadialGradient(flowX, mid, 0, flowX, mid, 70);
      fx.addColorStop(0, `rgba(200,228,255,${0.28 + 0.4 * lively})`);
      fx.addColorStop(1, "rgba(200,228,255,0)");
      ctx.fillStyle = fx;
      ctx.fillRect(flowX - 70, 0, 140, h);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="scope" aria-hidden />;
}
