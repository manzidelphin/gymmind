import { useRef, useState } from 'react';
import s from './PhoneInput.module.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

/**
 * Normalise digits to local display format: 0XXX XXX XXX.
 * Country-code prefix (250...) is converted to local (0...) automatically.
 * Second space only appears when all 10 digits are present.
 */
function formatPhoneDisplay(raw: string): string {
  let d = digitsOnly(raw);
  if (d.startsWith('250')) d = '0' + d.slice(3); // +250788… → 0788…
  d = d.slice(0, 10);                             // cap at 10 digits
  if (d.length <= 4) return d;
  if (d.length < 10) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

/** Resolve to the 10-digit local form (0XXXXXXXXX), handling 250-prefix pastes. */
function toLocal(value: string): string {
  const d = digitsOnly(value);
  if (d.startsWith('250')) return '0' + d.slice(3);
  return d;
}

function getPhoneError(value: string): string | null {
  if (!value.trim()) return null; // empty — let parent handle required
  const local = toLocal(value);
  if (!local.startsWith('0')) {
    if (local.length === 9) return `Did you forget the leading 0? Try 0${local}`;
    return 'Must start with 0 — e.g. 0700 000 000';
  }
  if (local.length < 10) return 'Phone number is too short';
  if (local.length > 10) return 'Phone number is too long';
  return null;
}

export function isPhoneValid(value: string): boolean {
  if (!value.trim()) return false;
  const local = toLocal(value);
  return local.startsWith('0') && local.length === 10;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PhoneInputProps {
  value: string;
  /** Called on every change with (formattedValue, isValid). */
  onChange: (value: string, isValid: boolean) => void;
  /** Extra CSS class forwarded to the <input> element. */
  inputClassName?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnter?: () => void;
  placeholder?: string;
  id?: string;
}

export default function PhoneInput({
  value,
  onChange,
  inputClassName = '',
  inputRef,
  onEnter,
  placeholder = '0700 000 000',
  id,
}: PhoneInputProps) {
  const [touched, setTouched] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? internalRef;

  const error = touched ? getPhoneError(value) : null;
  const valid = isPhoneValid(value);

  const borderClass = touched && value.trim()
    ? valid ? s.inputValid : s.inputError
    : '';

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatPhoneDisplay(e.target.value);
    onChange(formatted, isPhoneValid(formatted));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && onEnter) onEnter();
  }

  return (
    <div className={s.wrapper}>
      <input
        id={id}
        ref={ref}
        type="tel"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTouched(true)}
        className={`${inputClassName} ${borderClass}`}
      />
      {touched && error && value.trim() && (
        <span className={s.errorMsg}>{error}</span>
      )}
      {touched && valid && (
        <span className={s.validMsg}>✓</span>
      )}
    </div>
  );
}
