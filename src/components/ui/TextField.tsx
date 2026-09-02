import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Optional helper or error text shown under the field. */
  hint?: string;
}

/**
 * Minimal, calm labelled input built on the design tokens. Accessible by
 * default: the label is bound to the control and the hint is announced.
 */
export function TextField({ label, hint, id, className = '', ...props }: TextFieldProps) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, '-');
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={fieldId}
        dir="auto"
        aria-describedby={hintId}
        className={
          'w-full rounded-2xl border border-border bg-surface-raised px-5 py-4 text-base ' +
          'text-ink placeholder:text-ink-faint shadow-soft transition-colors ' +
          'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 ' +
          'disabled:opacity-50 ' +
          className
        }
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
