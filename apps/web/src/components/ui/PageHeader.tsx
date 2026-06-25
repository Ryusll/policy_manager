import type { ReactNode } from 'react';
import { clsx } from 'clsx';

type Props = {
  title: string;
  description?: string;
  /** 주요 액션 (버튼 1~2개) */
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, className }: Props) {
  return (
    <div className={clsx('page-header', className)}>
      <div className="page-header__text min-w-0">
        <h1 className="page-header__title">{title}</h1>
        {description ? <p className="page-header__desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions shrink-0">{actions}</div> : null}
    </div>
  );
}
