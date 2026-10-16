import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { Modal } from "./Modal";
import "./PresetMenu.css";

export function PresetMenu({
  presets,
  active,
  dirty = false,
  onSaved,
}: {
  presets: string[];
  active: string | null;
  dirty?: boolean;
  // Told the name after a save is requested, so the owner can re-baseline its
  // "edited" tracking even when the name (activePreset) doesn't change.
  onSaved?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Options = presets + the trailing actions (save; rename and delete when a
  // preset is active), so roving focus covers every item in the listbox.
  const actions = active ? 3 : 1;
  const optionCount = presets.length + actions;

  // Saving under a name that's taken (file names ignore case on Mac and Windows)
  // replaces that preset, so say so first.
  const replacing = presets.find((p) => p.toLowerCase() === name.trim().toLowerCase()) ?? null;
  // Renaming onto another preset's name isn't allowed (changing the case of this one is).
  const renameClash = presets.find(
    (p) => p.toLowerCase() === name.trim().toLowerCase() && p.toLowerCase() !== (active ?? "").toLowerCase(),
  ) ?? null;

  const doRename = () => {
    const n = name.trim();
    if (active && n && !renameClash && n !== active) { bridge.renamePreset(active, n); onSaved?.(n); }
    if (!renameClash) { setRenameOpen(false); setName(""); }
  };
  const doDelete = () => { if (active) bridge.deletePreset(active); setDeleteOpen(false); };

  const doSave = () => {
    const n = name.trim();
    if (n) { bridge.savePreset(n); onSaved?.(n); setSaveOpen(false); setName(""); }
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
          {active && (
            <>
              <button
                ref={(el) => { optionRefs.current[presets.length + 1] = el; }}
                role="option"
                aria-selected={false}
                tabIndex={-1}
                className="presetmenu__item presetmenu__item--save"
                onClick={() => { setOpen(false); setName(active); setRenameOpen(true); }}
                onKeyDown={(e) => onListKeyDown(e, presets.length + 1)}
              >
                Rename “{active}”…
              </button>
              <button
                ref={(el) => { optionRefs.current[presets.length + 2] = el; }}
                role="option"
                aria-selected={false}
                tabIndex={-1}
                className="presetmenu__item presetmenu__item--save"
                onClick={() => { setOpen(false); setDeleteOpen(true); }}
                onKeyDown={(e) => onListKeyDown(e, presets.length + 2)}
              >
                Delete “{active}”…
              </button>
            </>
          )}
        </div>
      )}

      {renameOpen && active && (
        <Modal title={`Rename “${active}”`} onClose={() => setRenameOpen(false)}>
          <input
            className="field"
            autoFocus
            placeholder="Preset name"
            aria-label="New name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doRename(); }}
          />
          {renameClash && (
            <p className="presetmenu__replace" role="status">There’s already a preset called “{renameClash}”.</p>
          )}
          <div className="modal__actions">
            <button className="btn" onClick={() => setRenameOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={doRename} disabled={!name.trim() || !!renameClash}>Rename</button>
          </div>
        </Modal>
      )}

      {deleteOpen && active && (
        <Modal title={`Delete “${active}”?`} onClose={() => setDeleteOpen(false)}>
          <p className="presetmenu__confirm">The preset file is deleted. What you’re playing now stays as it is.</p>
          <div className="modal__actions">
            <button className="btn" onClick={() => setDeleteOpen(false)}>Cancel</button>
            <button className="btn btn--danger" onClick={doDelete}>Delete</button>
          </div>
        </Modal>
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
          {replacing && (
            <p className="presetmenu__replace" role="status">
              There’s already a preset called “{replacing}”. Saving will replace it.
            </p>
          )}
          <div className="modal__actions">
            <button className="btn" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={doSave} disabled={!name.trim()}>
              {replacing ? "Replace" : "Save"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
