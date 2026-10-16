import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { Modal } from "./Modal";
import "./PresetMenu.css";

export function PresetMenu({
  presets,
  active,
  dirty = false,
}: {
  presets: string[];
  active: string | null;
  dirty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Options = presets + the trailing "Save current rig…" action, so roving focus
  // covers every item in the listbox.
  const optionCount = presets.length + 1;

  const doSave = () => {
    const n = name.trim();
    if (n) { bridge.savePreset(n); setSaveOpen(false); setName(""); }
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Move focus into the list on open — onto the active preset if there is one.
  useEffect(() => {
    if (!open) return;
    const start = active ? Math.max(0, presets.indexOf(active)) : 0;
    optionRefs.current[start]?.focus();
  }, [open, active, presets]);

  const focusOption = (i: number) => {
    const idx = (i + optionCount) % optionCount;
    optionRefs.current[idx]?.focus();
  };

  const onListKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); focusOption(index + 1); break;
      case "ArrowUp": e.preventDefault(); focusOption(index - 1); break;
      case "Home": e.preventDefault(); focusOption(0); break;
      case "End": e.preventDefault(); focusOption(optionCount - 1); break;
      case "Escape": e.preventDefault(); close(); break;
    }
  };

  return (
    <div className="presetmenu" ref={ref}>
      <button
        ref={triggerRef}
        className="presetmenu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="presetmenu__eyebrow eyebrow">Preset</span>
        <span className="presetmenu__name">
          {active ?? "Init"}
          {dirty && <span className="presetmenu__dirty" title="Unsaved changes"> • edited</span>}
        </span>
        <span className={`presetmenu__chev ${open ? "is-open" : ""}`} aria-hidden>▾</span>
      </button>

      {open && (
        <div className="presetmenu__pop" role="listbox" aria-label="Presets">
          {presets.map((p, i) => (
            <button
              key={p}
              ref={(el) => { optionRefs.current[i] = el; }}
              role="option"
              aria-selected={p === active}
              tabIndex={-1}
              className={`presetmenu__item ${p === active ? "is-active" : ""}`}
              onClick={() => { bridge.loadPreset(p); close(); }}
              onKeyDown={(e) => onListKeyDown(e, i)}
            >
              <span className="presetmenu__dot" />
              {p}
            </button>
          ))}
          <div className="presetmenu__divider" />
          {/* Preset rename / delete would live here, but both need native engine
              functions that aren't exposed yet — deferred. */}
          {/* TODO: add rename / delete once the C++ engine exposes renamePreset/deletePreset. */}
          <button
            ref={(el) => { optionRefs.current[presets.length] = el; }}
            role="option"
            aria-selected={false}
            tabIndex={-1}
            className="presetmenu__item presetmenu__item--save"
            onClick={() => { setOpen(false); setName(active ? `${active} copy` : ""); setSaveOpen(true); }}
            onKeyDown={(e) => onListKeyDown(e, presets.length)}
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
