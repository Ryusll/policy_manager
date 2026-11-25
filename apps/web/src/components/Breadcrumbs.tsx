import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../stores/authStore';
import { breadcrumbFor } from '../lib/routeSections';
import { roleCanOpen } from '../lib/viewerAccess';
import { amendmentDetailQuery, lawDetailQuery } from '../api/detailQueries';
import { amendmentTargetLabel } from '../lib/amendmentTarget';

/*
 * 상단 경로 표시(브레드크럼) — T-212, SRS NFR-9. 어떤 경로에 무엇을 그릴지는 lib/routeSections.
 *
 * 상세 이름은 상세 화면이 받아 둔 조회 결과를 같은 조회 키로 읽기만 한다(enabled: false).
 * 경로 표시 때문에 요청이 생기지 않고, 상세 화면이 받으면 그때 이름이 들어온다 — 그 전이나
 * 받지 못했으면 '상세'. (예전에는 규정 제목 하나를 얻으려고 전문을 한 번 더 받았다 — T-183 ⑤)
 */

function LawName({ id }: { id: string }) {
  const { t } = useI18n();
  const { data } = useQuery({ ...lawDetailQuery(id), enabled: false });
  return <>{data?.lawName || t('layout.breadcrumb.detail')}</>;
}

function AmendmentName({ id }: { id: string }) {
  const { t } = useI18n();
  const { data } = useQuery({ ...amendmentDetailQuery(id), enabled: false });
  if (!data) return <>{t('layout.breadcrumb.detail')}</>;
  // 개정 후보 상세 머리와 같은 함수(규정 제목 + 조 머리 표기 '제3조(목적)', T-214)
  return <>{amendmentTargetLabel(data.policy.title, data.article)}</>;
}

export default function Breadcrumbs() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const crumbs = breadcrumbFor(pathname);
  if (!crumbs) return null;

  // 그 역할이 열 수 없는 화면(열람자의 대시보드·규정 목록)은 링크 대신 글자로 — 눌러도 다른 화면으로 튕기지 않게(T-172 판정)
  const linkOr = (to: string, label: ReactNode, className: string) =>
    roleCanOpen(role, to) ? (
      <Link to={to} className={`hover:text-navy-700 hover:underline ${className}`}>
        {label}
      </Link>
    ) : (
      <span className={className}>{label}</span>
    );

  return (
    <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-2">
      <nav aria-label={t('layout.breadcrumb.label')} className="max-w-6xl mx-auto">
        <ol className="flex items-center gap-1 text-xs text-gray-500 min-w-0">
          <li className="shrink-0">{linkOr('/', t('layout.breadcrumb.home'), '')}</li>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.kind === 'section' ? c.to : `${c.detail}:${c.id}`} className="flex items-center gap-1 min-w-0">
                <ChevronRight size={12} className="shrink-0" aria-hidden />
                {c.kind === 'detail' ? (
                  <span className="text-gray-700 truncate" aria-current="page">
                    {c.detail === 'law' ? <LawName id={c.id} /> : <AmendmentName id={c.id} />}
                  </span>
                ) : last ? (
                  <span className="text-gray-700 truncate" aria-current="page">
                    {t(c.labelKey)}
                  </span>
                ) : (
                  linkOr(c.to, t(c.labelKey), 'truncate')
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
