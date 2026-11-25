import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastState = {
  items: ToastItem[];
  /** ms — 머무는 시간(없으면 4.2초). 긴 안내가 읽기 전에 사라지지 않게(T-224) */
  push: (message: string, variant?: ToastVariant, ms?: number) => void;
  dismiss: (id: string) => void;
  /** 떠 있는 안내를 모두 내린다 — 로그아웃·다른 사용자 로그인 때(T-181) */
  clear: () => void;
};

let seq = 0;
/** 알림이 머무는 기본 시간 */
export const TOAST_MS = 4200;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, variant = 'info', ms = TOAST_MS) => {
    const id = `toast-${++seq}-${Date.now()}`;
    set((s) => ({ items: [...s.items, { id, message, variant }] }));
    window.setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, ms);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}));

export function toast(message: string, variant?: ToastVariant, ms?: number) {
  useToastStore.getState().push(message, variant, ms);
}
