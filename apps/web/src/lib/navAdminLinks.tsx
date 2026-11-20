import type { LucideIcon } from 'lucide-react';
import type { NavDisclosureItem } from '../components/NavDisclosure';
import { navCurrent } from './routeSections';

type AdminNavItem = { path: string; id: string; label: string; icon: LucideIcon };

/**
 * 상단 '관리' 묶음의 링크(T-226) — 경로 표(navItemsFor 의 admin)의 항목에 아이콘과 지금 화면 표시(aria-current — 그 화면이면 page,
 * 그 아래 화면이면 true)를 붙인다. 닫힌 묶음은 링크를 그리지 않으므로 시험이 이 함수를 바로 본다(1차 검토).
 */
export function adminLinks(items: AdminNavItem[], pathname: string): NavDisclosureItem[] {
  return items.map(({ path, label, icon: Icon, id }) => ({
    key: path,
    id,
    to: path,
    label,
    icon: <Icon size={15} className="text-gray-500" />,
    current: navCurrent(pathname, path),
  }));
}
