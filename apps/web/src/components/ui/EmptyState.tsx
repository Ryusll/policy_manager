import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function EmptyState({ icon: Icon, title, description, action, className, compact }: Props) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-12 px-6',
        className,
      )}
    >
      {Icon ? <Icon size={compact ? 28 : 36} className="text-gray-300 mb-3" strokeWidth={1.25} /> : null}
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description ? <p className="text-xs text-gray-500 mt-1 max-w-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
