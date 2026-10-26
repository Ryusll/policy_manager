import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastState = {
  items: ToastItem[];
  push: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
  /** 떠 있는 안내를 모두 내린다 — 로그아웃·다른 사용자 로그인 때(T-181) */
  clear: () => void;
};

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, variant = 'info') => {
    const id = `toast-${++seq}-${Date.now()}`;
    set((s) => ({ items: [...s.items, { id, message, variant }] }));
    window.setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, 4200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}));

export function toast(message: string, variant?: ToastVariant) {
  useToastStore.getState().push(message, variant);
}
