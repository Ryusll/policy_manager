import { clsx } from 'clsx';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useToastStore } from '../../stores/toastStore';

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

export default function ToastHost() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed top-3 right-3 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
    >
      {items.map((item) => {
        const Icon = icons[item.variant];
        return (
          <div
            key={item.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-lg text-sm',
              'bg-white',
              item.variant === 'success' && 'border-emerald-200 text-emerald-900',
              item.variant === 'error' && 'border-red-200 text-red-900',
              item.variant === 'info' && 'border-gray-200 text-gray-800',
            )}
          >
            <Icon
              size={18}
              className={clsx(
                'shrink-0 mt-0.5',
                item.variant === 'success' && 'text-emerald-600',
                item.variant === 'error' && 'text-red-600',
                item.variant === 'info' && 'text-navy-600',
              )}
            />
            <p className="flex-1 leading-snug">{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="shrink-0 text-gray-400 hover:text-gray-700 p-0.5"
              aria-label="닫기"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
