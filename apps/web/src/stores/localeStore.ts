import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Locale = 'ko' | 'en';

interface State {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<State>()(
  persist(
    (set) => ({
      locale: 'ko',
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'policy-manager-locale' },
  ),
);
