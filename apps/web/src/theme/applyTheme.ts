import type { ThemePalette } from './presets';
import { PRESETS, type ThemePresetId } from './presets';

function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

function toTriplet(rgb: [number, number, number]): string {
  return `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
}

/** primary = 다크 헤더(구 navy-900), accent = 포인트(구 gold-500) */
export function buildCustomPalette(primaryHex: string, accentHex: string): ThemePalette {
  const p = parseHex(primaryHex) ?? [30, 57, 50];
  const acc = parseHex(accentHex) ?? [212, 165, 116];
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];

  const weights = [0.05, 0.1, 0.16, 0.24, 0.33, 0.43, 0.54, 0.66, 0.78, 1];
  const keys: Array<keyof ThemePalette['navy']> = [
    '50',
    '100',
    '200',
    '300',
    '400',
    '500',
    '600',
    '700',
    '800',
    '900',
  ];
  const navy = {} as ThemePalette['navy'];
  keys.forEach((key, i) => {
    const t = weights[i];
    const rgb = mixRgb(white, p, t);
    navy[key] = toTriplet(rgb);
  });

  const gold400 = mixRgb(white, acc, 0.35);
  const gold500 = acc;
  const gold600 = mixRgb(acc, black, 0.18);

  return {
    navy,
    gold: {
      '400': toTriplet(gold400),
      '500': toTriplet(gold500),
      '600': toTriplet(gold600),
    },
  };
}

export function applyPalette(palette: ThemePalette): void {
  const root = document.documentElement;
  (Object.entries(palette.navy) as [string, string][]).forEach(([k, v]) => {
    root.style.setProperty(`--color-navy-${k}`, v);
  });
  (Object.entries(palette.gold) as [string, string][]).forEach(([k, v]) => {
    root.style.setProperty(`--color-gold-${k}`, v);
  });
}

export function applyTheme(
  mode: 'preset' | 'custom',
  presetId: ThemePresetId,
  customPrimaryHex: string,
  customAccentHex: string,
): void {
  if (mode === 'preset') {
    applyPalette(PRESETS[presetId]);
    return;
  }
  applyPalette(buildCustomPalette(customPrimaryHex, customAccentHex));
}
