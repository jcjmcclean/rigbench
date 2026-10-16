import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { Modal } from "./Modal";
import "./PresetMenu.css";

export function PresetMenu({ presets, active }: { presets: string[]; active: string | null }) {
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const doSave = () => {
    const n = name.trim();
    if (n) { bridge.savePreset(n); setSaveOpen(false); setName(""); }
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="presetmenu" ref={ref}>
      <button className="presetmenu__trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="presetmenu__eyebrow eyebrow">Preset</span>
        <span className="presetmenu__name">{active ?? "Init"}</span>
        <span className={`presetmenu__chev ${open ? "is-open" : ""}`} aria-hidden>▾</span>
      </button>

      {open && (
        <div className="presetmenu__pop" role="listbox">
          {presets.map((p) => (
            <button
              key={p}
              role="option"
              aria-selected={p === active}
              className={`presetmenu__item ${p === active ? "is-active" : ""}`}
              onClick={() => { bridge.loadPreset(p); setOpen(false); }}
            >
              <span className="presetmenu__dot" />
              {p}
            </button>
          ))}
          <div className="presetmenu__divider" />
          <button
            className="presetmenu__item presetmenu__item--save"
            onClick={() => { setOpen(false); setName(active ? `${active} copy` : ""); setSaveOpen(true); }}
          >
            + Save current rig…
          </button>
        </div>
      )}

      {saveOpen && (
        <Modal title="Save current rig" onClose={() => setSaveOpen(false)}>
          <input
            className="field"
            autoFocus
            placeholder="Preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doSave(); }}
          />
          <div className="modal__actions">
            <button className="btn" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={doSave} disabled={!name.trim()}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
