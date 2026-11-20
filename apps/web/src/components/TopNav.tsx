import { Link, useLocation } from 'react-router-dom';
import {
  FileDiff,
  FileText,
  LayoutDashboard,
  MessageCircleQuestion,
  PlugZap,
  Scale,
  ScrollText,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Variable,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../stores/authStore';
import { useAskStatus } from '../hooks/useAskStatus';
import { activeNavPath, navContextFor, navCurrent, navItemsFor, type NavContext, type NavItem } from '../lib/routeSections';
import { adminLinks } from '../lib/navAdminLinks';
import AmendmentsNavBadge from './AmendmentsNavBadge';
import NavDisclosure from './NavDisclosure';

/*
 * 상단 메뉴(T-214, SRS NFR-10) — 날마다 쓰는 업무 메뉴는 펼쳐 두고, 회사 단위 관리 화면은 '관리' 묶음에 넣는다.
 * 어떤 항목이 누구에게 보이는지는 경로 표(lib/routeSections 의 navItemsFor) 한 곳이 정한다 — 경로 표시·열람자 허용 경로와 같은 표.
 * '관리' 묶음은 사이트 이동 링크라 disclosure 패턴(NavDisclosure, T-226) — 묶음을 열면 그 안 링크가 화면 읽기 프로그램의 링크
 * 목록에 나온다(닫혀 있으면 접근성 트리에 없다 — APG disclosure 와 같다).
 */

const NAV_ICONS: Record<string, LucideIcon> = {
  'nav-dashboard': LayoutDashboard,
  'nav-policies': FileText,
  'nav-laws': Scale,
  'nav-amendments': FileDiff,
  'nav-search': Search,
  'nav-ask': MessageCircleQuestion,
  'nav-variables': Variable,
  'nav-settings': Settings,
  'nav-integrations': PlugZap,
  'nav-audit-logs': ScrollText,
  'nav-platform-admin': Shield,
};

type ShownItem = NavItem & { label: string; icon: LucideIcon };

/** 지금 사용자의 메뉴 노출 조건 — 규정 질문 상태는 메뉴라 자주 다시 받지 않는다 */
function useNavContext(): NavContext {
  const user = useAuthStore((s) => s.user);
  const { data: ask } = useAskStatus({ enabled: !!user, staleTime: 5 * 60_000 });
  return navContextFor(user, ask);
}

/** 이 조건에서 보일 메뉴 — 이름·아이콘을 붙인다(가볍게 다시 만든다 — 항목은 열몇 개) */
function useShownNav(ctx: NavContext): { main: ShownItem[]; admin: ShownItem[] } {
  const { t } = useI18n();
  const { main, admin } = navItemsFor(ctx);
  const shown = (i: NavItem): ShownItem => ({ ...i, label: t(i.labelKey), icon: NAV_ICONS[i.id] ?? FileText });
  return { main: main.map(shown), admin: admin.map(shown) };
}


/** 데스크톱 상단 메뉴 */
export function DesktopNav() {
  return <DesktopNavView ctx={useNavContext()} />;
}

/** 모바일 사이드바 메뉴 */
export function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  return <MobileNavView ctx={useNavContext()} onNavigate={onNavigate} />;
}

/** 데스크톱 상단 메뉴 그리기 — 노출 조건을 받아 그린다(시험이 조건별로 그려 본다) */
export function DesktopNavView({ ctx }: { ctx: NavContext }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const nav = useShownNav(ctx);
  const linkClass = (active: boolean) =>
    clsx(
      'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors',
      active ? 'border-gold-500 text-white' : 'border-transparent text-navy-300 hover:text-white hover:border-navy-400',
    );
  // 지금 화면의 메뉴 항목 — 라우터와 같은 꼴로 본다(대소문자·옛 주소 /platform-admin 도 같은 항목)
  const current = activeNavPath(pathname);
  const adminActive = nav.admin.some((i) => i.path === current);
  return (
    <nav className="hidden lg:flex px-4 bg-navy-800" aria-label={t('layout.nav.label')}>
      {nav.main.map(({ path, label, icon: Icon, id }) => (
        <Link key={path} to={path} id={id} aria-current={navCurrent(pathname, path)} className={linkClass(path === current)}>
          <Icon size={15} />
          {label}
          {path === '/amendments' && <AmendmentsNavBadge />}
        </Link>
      ))}
      {nav.admin.length > 0 && (
        <NavDisclosure
          id="nav-admin-group"
          label={t('layout.nav.adminGroup')}
          icon={<SlidersHorizontal size={15} />}
          active={adminActive}
          currentLabel={t('layout.nav.currentGroup')}
          buttonClassName={linkClass(adminActive)}
          items={adminLinks(nav.admin, pathname)}
        />
      )}
    </nav>
  );
}

/** 모바일 사이드바 메뉴 그리기 — '관리' 묶음은 구역 제목 아래에 펼친다 */
export function MobileNavView({ ctx, onNavigate }: { ctx: NavContext; onNavigate: () => void }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const current = activeNavPath(pathname);
  const nav = useShownNav(ctx);
  const item = ({ path, label, icon: Icon, id }: ShownItem) => (
    <Link
      key={path}
      to={path}
      id={id + '-mobile'}
      aria-current={navCurrent(pathname, path)}
      onClick={onNavigate}
      className={clsx(
        'flex items-center gap-3 px-4 py-3 text-sm transition-colors',
        path === current
          ? 'bg-navy-700 text-white border-l-2 border-gold-500'
          : 'text-navy-300 hover:bg-navy-700 hover:text-white',
      )}
    >
      <Icon size={16} />
      {label}
      {path === '/amendments' && <AmendmentsNavBadge />}
    </Link>
  );
  return (
    <nav className="flex-1 py-2" aria-label={t('layout.nav.label')}>
      {nav.main.map(item)}
      {nav.admin.length > 0 && (
        <>
          {/* 보조기기에도 '관리' 묶음으로 전해지게 — 구역 제목이 묶음 이름이다 */}
          <div role="group" aria-labelledby="nav-admin-group-mobile-title">
            <div id="nav-admin-group-mobile-title" className="px-4 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-navy-400">
              {t('layout.nav.adminGroup')}
            </div>
            {nav.admin.map(item)}
          </div>
        </>
      )}
    </nav>
  );
}
