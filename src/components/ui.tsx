import { ReactNode, useState } from "react";
import type { Settings } from "../api";

export type SetFn = (key: string, value: unknown) => void;

export interface Bind {
  s: Settings;
  set: SetFn;
}

export function Card({ title, icon, children, collapsible = true, defaultOpen = true, aside }: {
  title: string; icon?: string; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean; aside?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`card ${open ? "open" : ""}`}>
      <header className="card-head" onClick={() => collapsible && setOpen(!open)}>
        <span className="card-title">{icon && <span className="card-icon">{icon}</span>}{title}</span>
        <span className="card-aside" onClick={(e) => e.stopPropagation()}>{aside}</span>
        {collapsible && <span className="chev">{open ? "▾" : "▸"}</span>}
      </header>
      {open && <div className="card-body">{children}</div>}
    </section>
  );
}

export function Row({ children, cols }: { children: ReactNode; cols?: string }) {
  return <div className="row" style={cols ? { gridTemplateColumns: cols } : undefined}>{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Select({ b, k, label, options, disabled, hint }: {
  b: Bind; k: string; label: string; options: (string | number)[]; disabled?: boolean; hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={String(b.s[k])}
        disabled={disabled}
        onChange={(e) => {
          const o = options.find((x) => String(x) === e.target.value);
          b.set(k, o ?? e.target.value);
        }}
      >
        {options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    </Field>
  );
}

export function Slider({ b, k, label, min, max, step = 1, disabled, unit, hint }: {
  b: Bind; k: string; label: string; min: number; max: number; step?: number; disabled?: boolean; unit?: string; hint?: string;
}) {
  const v = Number(b.s[k]);
  return (
    <Field label={label} hint={hint}>
      <div className={`slider ${disabled ? "disabled" : ""}`}>
        <input type="range" min={min} max={max} step={step} value={v} disabled={disabled}
          onChange={(e) => b.set(k, Number(e.target.value))} />
        <span className="slider-val">{step < 1 ? v.toFixed(2) : v}{unit ?? ""}</span>
      </div>
    </Field>
  );
}

export function NumberIn({ b, k, label, min, max, step = 1, disabled, hint }: {
  b: Bind; k: string; label: string; min: number; max: number; step?: number; disabled?: boolean; hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Number(raw.replace(",", "."));
    if (!Number.isNaN(n)) b.set(k, Math.min(max, Math.max(min, n)));
  };
  return (
    <Field label={label} hint={hint}>
      <input type="number" min={min} max={max} step={step} disabled={disabled}
        value={draft ?? String(b.s[k])}
        onChange={(e) => { setDraft(e.target.value); if (e.target.value !== "" && !Number.isNaN(Number(e.target.value))) b.set(k, Math.min(max, Math.max(min, Number(e.target.value)))); }}
        onBlur={(e) => commit(e.target.value)} />
    </Field>
  );
}

export function Check({ b, k, label, disabled, hint }: { b: Bind; k: string; label: string; disabled?: boolean; hint?: string }) {
  return (
    <label className={`check ${disabled ? "disabled" : ""}`} title={hint}>
      <input type="checkbox" checked={!!b.s[k]} disabled={disabled} onChange={(e) => b.set(k, e.target.checked)} />
      <span className="box" />
      <span>{label}</span>
    </label>
  );
}

export function Toggle({ b, k, label, hint }: { b: Bind; k: string; label: string; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={!!b.s[k]} onChange={(e) => b.set(k, e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

/** Casilla + color en la misma fila (Rellenar / Trazo / Fondo / Sombra, como en Premiere). */
export function ColorToggle({ b, k, label, disabled }: { b: Bind; k: string; label: string; disabled?: boolean }) {
  const on = !!b.s[`${k}_on`];
  return (
    <div className="color-toggle">
      <Check b={b} k={`${k}_on`} label={label} disabled={disabled} />
      <input type="color" value={b.s[`${k}_color`]} disabled={disabled || !on}
        onChange={(e) => b.set(`${k}_color`, e.target.value.toUpperCase())} />
    </div>
  );
}

export function Button({ children, onClick, kind = "secondary", disabled, busy, full, title }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean; busy?: boolean; full?: boolean; title?: string;
}) {
  return (
    <button className={`btn ${kind} ${full ? "full" : ""}`} onClick={onClick} disabled={disabled || busy} title={title}>
      {busy && <span className="spinner" />}
      {children}
    </button>
  );
}

export function Progress({ value, msg }: { value: number; msg: string }) {
  return (
    <div className="progress">
      <div className="progress-bar"><div style={{ width: `${Math.round(value * 100)}%` }} /></div>
      <div className="progress-msg">{msg} · {Math.round(value * 100)} %</div>
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}
