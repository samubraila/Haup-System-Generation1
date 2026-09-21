import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/format';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-gradient text-white shadow-glow hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-raised text-ink border border-edge hover:bg-surface-hover hover:border-edge-strong',
  ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink',
  danger: 'bg-state-danger/15 text-state-danger border border-state-danger/30 hover:bg-state-danger/25',
  success: 'bg-state-success/15 text-state-success border border-state-success/30 hover:bg-state-success/25',
  outline: 'border border-edge-strong text-ink hover:bg-surface-hover',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
  icon: 'h-9 w-9 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center rounded-xl font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-edge px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-ink">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  className,
  tone = 'idle',
}: {
  children: ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span className={cn('relative flex h-2 w-2', pulse && 'animate-pulse-ring rounded-full')}>
      <span className={cn('h-2 w-2 rounded-full', className)} />
    </span>
  );
}

export function Progress({
  value,
  className,
  barClassName,
  showLabel,
}: {
  value: number;
  className?: string;
  barClassName?: string;
  showLabel?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
        <motion.div
          className={cn('h-full rounded-full bg-brand-gradient', barClassName)}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      {showLabel ? <span className="w-10 text-right text-xs tabular-nums text-ink-muted">{clamped}%</span> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-ink-muted', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <div className="rounded-2xl bg-surface-hover p-3 text-ink-faint">{icon}</div> : null}
      <div>
        <p className="font-medium text-ink">{title}</p>
        {description ? <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label className="flex items-center gap-1 text-sm font-medium text-ink-muted">
          {label}
          {required ? <span className="text-state-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-state-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn('input-base', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn('input-base min-h-[96px] resize-y', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn('input-base cursor-pointer appearance-none pr-9', className)} {...props}>
      {children}
    </select>
  );
});

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-brand-500 bg-brand-500' : 'border-edge-strong bg-surface-hover',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className={cn('block h-4 w-4 rounded-full bg-white shadow', checked ? 'ml-6' : 'ml-1')}
        />
      </button>
      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-sm font-medium text-ink">{label}</span> : null}
          {description ? <span className="block text-xs text-ink-muted">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn(
              'flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-edge bg-surface shadow-card sm:rounded-2xl',
              widths[size],
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink">{title}</h2>
                {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Schliessen">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer ? <div className="border-t border-edge px-5 py-4">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-edge bg-surface p-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
            value === tab.value ? 'text-ink' : 'text-ink-muted hover:text-ink',
          )}
        >
          {value === tab.value ? (
            <motion.span
              layoutId="tab-pill"
              className="absolute inset-0 rounded-lg bg-surface-hover"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          ) : null}
          <span className="relative flex items-center gap-2">
            {tab.label}
            {tab.count !== undefined ? (
              <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-[11px] tabular-nums text-ink-muted">
                {tab.count}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirmContext() {
  return useContext(ConfirmContext);
}

export { ConfirmContext };
