import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyTheme } from '../theme/applyTheme';
import type { ThemePresetId } from '../theme/presets';

export type ThemeMode = 'preset' | 'custom';

interface ThemeState {
  mode: ThemeMode;
  presetId: ThemePresetId;
  customPrimaryHex: string;
  customAccentHex: string;
  setPresetMode: (id: ThemePresetId) => void;
  setCustomMode: (primaryHex: string, accentHex: string) => void;
  resetTheme: () => void;
  hydrateToDocument: () => void;
}

const DEFAULT_PRIMARY = '#1E3932';
const DEFAULT_ACCENT = '#d4a574';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'preset',
      presetId: 'forest',
      customPrimaryHex: DEFAULT_PRIMARY,
      customAccentHex: DEFAULT_ACCENT,

      setPresetMode: (id: ThemePresetId) => {
        set({ mode: 'preset', presetId: id });
        applyTheme('preset', id, get().customPrimaryHex, get().customAccentHex);
      },

      setCustomMode: (primaryHex: string, accentHex: string) => {
        set({ mode: 'custom', customPrimaryHex: primaryHex, customAccentHex: accentHex });
        applyTheme('custom', get().presetId, primaryHex, accentHex);
      },

      resetTheme: () => {
        set({ mode: 'preset', presetId: 'forest', customPrimaryHex: DEFAULT_PRIMARY, customAccentHex: DEFAULT_ACCENT });
        applyTheme('preset', 'forest', DEFAULT_PRIMARY, DEFAULT_ACCENT);
      },

      hydrateToDocument: () => {
        const { mode, presetId, customPrimaryHex, customAccentHex } = get();
        applyTheme(mode, presetId, customPrimaryHex, customAccentHex);
      },
    }),
    {
      name: 'veda-theme',
    },
  ),
);
