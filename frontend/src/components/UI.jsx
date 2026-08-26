import React from "react";
import { X } from "lucide-react";

export function Modal({ title, eyebrow = "Form operasional", onClose, children }) {
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      data-testid="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" data-testid="modal-panel">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 data-testid="modal-title">{title}</h2>
          </div>
          <button
            data-testid="modal-close-button"
            className="icon-button"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }) {
  return (
    <span
      data-testid={`badge-${String(children).toLowerCase().replaceAll(" ", "-")}`}
      className={`badge badge-${tone}`}
    >
      {children}
    </span>
  );
}

export function Field({ label, testid, value, onChange, type = "text", placeholder, required }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        data-testid={testid}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function SelectField({ label, value, onChange, options, testid }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          )
        )}
      </select>
    </label>
  );
}

export function PageIntro({ eyebrow, title, subtitle, action, testid }) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 data-testid={testid}>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function PanelHead({ title, detail, action, onAction }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {action && (
        <button
          data-testid="panel-action-button"
          className="text-button"
          onClick={onAction}
        >
          {action} ›
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, actionLabel, onAction, testid }) {
  return (
    <section className="empty-module">
      <div className="module-icon">◆</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {actionLabel && (
        <button
          data-testid={testid || "empty-action"}
          className="secondary-button"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
}
