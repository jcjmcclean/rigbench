import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { soundLinks } from "../links";
import type { PluginInfo } from "../types";
import { Modal } from "./Modal";
import "./PluginPicker.css";

// Above this many plugins, show a filter box.
const FILTER_FROM = 8;

// Pick a VST3 for the plugin slot from the ones installed in the standard
// folders, or browse for one anywhere else.
export function PluginPicker({ onClose }: { onClose: () => void }) {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    bridge.listPlugins().then((p) => { if (live) setPlugins(p); });
    return () => { live = false; };
  }, []);

  const shown = (plugins ?? []).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const pick = (p: PluginInfo) => { bridge.loadPlugin(p.path); onClose(); };
  const browse = () => { bridge.loadSlot("vst3"); onClose(); };

  return (
    <Modal title="Load a plugin" onClose={onClose}>
      {plugins === null ? (
        <p className="picker__note">Looking for plugins…</p>
      ) : plugins.length === 0 ? (
        <div className="picker__empty">
          <p className="picker__note">No VST3 plugins in the usual folders. Free ones to try:</p>
          {soundLinks.vst3.map((l) => (
            <button key={l.url} className="picker__link" onClick={() => bridge.openUrl(l.url)}>{l.label}</button>
          ))}
        </div>
      ) : (
        <>
          {plugins.length > FILTER_FROM && (
            <input
              className="field picker__filter"
              placeholder="Filter"
              aria-label="Filter plugins"
              value={filter}
              autoFocus
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          <ul className="picker__list" aria-label="Installed plugins">
            {shown.map((p) => (
              <li key={p.path}>
                <button className="picker__item" onClick={() => pick(p)} title={p.path}>{p.name}</button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="picker__note">Nothing matches “{filter.trim()}”.</p>}
        </>
      )}
      <div className="modal__actions">
        <button className="btn picker__browse" onClick={browse}>Browse…</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
