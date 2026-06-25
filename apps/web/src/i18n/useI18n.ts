import { useCallback, useMemo } from 'react';
import { useLocaleStore, type Locale } from '../stores/localeStore';
import { messages } from './messages';

/** Replace {name} placeholders in a string */
function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function useI18n() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const table = messages[locale] as Record<string, string>;
      let raw = table[key];
      if (raw == null) {
        const fallback = messages.ko as Record<string, string>;
        raw = fallback[key] ?? key;
      }
      return vars ? interpolate(raw, vars) : raw;
    },
    [locale],
  );

  const isEn = useMemo(() => locale === 'en', [locale]);

  return { t, locale, setLocale, isEn };
}

export type { Locale };
