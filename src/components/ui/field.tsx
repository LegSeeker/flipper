import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';
import { cn, parseNumber } from '@/lib/utils';
import { currencySymbol } from '@/lib/money';
import { useSettings } from '@/app/context';

export const inputClass =
  'w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60';

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  // Link the label to a single child control automatically (accessibility + tap-to-focus).
  const autoId = useId();
  let control = children;
  let forId = htmlFor;
  if (!forId && label && isValidElement<{ id?: string }>(children)) {
    forId = children.props.id ?? autoId;
    if (!children.props.id) control = cloneElement(children, { id: autoId });
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={forId} className="text-xs font-medium text-muted">
          {label}
        </label>
      )}
      {control}
      {error ? (
        <p className="text-xs text-loss">{error}</p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(inputClass, 'resize-y py-2 leading-relaxed', className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(inputClass, 'h-10 appearance-none bg-[length:16px] pr-8', className)}
      {...rest}
    >
      {children}
    </select>
  );
});

/** Labelled input in one call: <TextField label="Name" value=... onChange=... /> */
export function TextField({
  label,
  hint,
  value,
  onChange,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

/**
 * Number input that keeps the user's raw text while typing (so "12," or "0." are
 * allowed) and reports a parsed number or null.
 */
export function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  className,
  allowEmpty = true,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'prefix'> & {
  value: number | null;
  onChange: (v: number | null) => void;
  prefix?: string;
  suffix?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = parseNumber(text);
    if (parsed !== value) setText(value === null || value === undefined ? '' : String(value));
    // Only react to outside changes of `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn('relative flex items-center', className)}>
      {prefix && <span className="pointer-events-none absolute left-3 text-sm text-subtle">{prefix}</span>}
      <input
        inputMode="decimal"
        autoComplete="off"
        className={cn(inputClass, 'tabular h-10', prefix && 'pl-8', suffix && 'pr-10')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumber(e.target.value);
          if (n !== null) onChange(n);
          else if (!e.target.value.trim()) onChange(allowEmpty ? null : 0);
        }}
        {...rest}
      />
      {suffix && <span className="pointer-events-none absolute right-3 text-sm text-subtle">{suffix}</span>}
    </div>
  );
}

export function MoneyField({
  label,
  hint,
  value,
  onChange,
  className,
  allowEmpty = true,
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  const { locale, currency } = useSettings();
  const id = useId();
  const sym = currencySymbol(locale, currency);
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <NumberInput
        id={id}
        value={value}
        onChange={onChange}
        allowEmpty={allowEmpty}
        prefix={sym.length <= 2 ? sym : undefined}
        suffix={sym.length > 2 ? sym : undefined}
        placeholder={placeholder ?? '0.00'}
      />
    </Field>
  );
}

export function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const tags = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) onChange([...new Set([...value, ...tags])]);
    setText('');
  };
  return (
    <div className={cn(inputClass, 'flex min-h-10 flex-wrap items-center gap-1.5 py-1.5')}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-0.5 text-xs">
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="text-subtle hover:text-fg"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent outline-none placeholder:text-subtle"
        value={text}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input
        type="checkbox"
        className="size-4 rounded accent-[var(--accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {description && <span className="block text-xs text-subtle">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}
