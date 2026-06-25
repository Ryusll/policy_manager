import { useEffect } from 'react';
import { useThemeStore } from '../stores/themeStore';

/** localStorage 테마 복원 후 CSS 변수 재적용 */
export function ThemeHydrate() {
  useEffect(() => {
    useThemeStore.getState().hydrateToDocument();
    const p = useThemeStore.persist;
    if (typeof p?.onFinishHydration === 'function') {
      return p.onFinishHydration(() => {
        useThemeStore.getState().hydrateToDocument();
      });
    }
    return undefined;
  }, []);

  return null;
}
