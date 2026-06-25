import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { notificationsApi } from '../api/notifications';
import { clsx } from 'clsx';

export default function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 45_000,
  });

  const { data: items = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(30),
    enabled: open,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const count = unread?.count ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-navy-200 hover:bg-navy-800 hover:text-white transition-colors"
        aria-label="알림"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-gold-500 text-navy-900 text-[10px] font-bold flex items-center justify-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-[min(92vw,360px)] bg-white border border-gray-300 shadow-xl rounded z-50 text-gray-800">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
            <span className="text-xs font-semibold">알림</span>
            {count > 0 && (
              <button
                type="button"
                className="text-[11px] text-navy-700 hover:underline"
                onClick={() => markAllMutation.mutate()}
              >
                모두 읽음
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-xs text-gray-500 px-3 py-6 text-center">알림이 없습니다.</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={clsx(
                    'px-3 py-2.5 border-b border-gray-100 text-xs',
                    !n.readAt && 'bg-sky-50/80',
                  )}
                >
                  <div className="font-semibold text-gray-900">{n.title}</div>
                  <pre className="text-gray-600 mt-1 whitespace-pre-wrap font-sans leading-relaxed">
                    {n.body}
                  </pre>
                  <div className="mt-1.5 flex items-center gap-2">
                    {n.policyId && (
                      <Link
                        to={`/policies/${n.policyId}`}
                        className="text-navy-700 hover:underline"
                        onClick={() => {
                          if (!n.readAt) markReadMutation.mutate(n.id);
                          setOpen(false);
                        }}
                      >
                        규정 보기
                      </Link>
                    )}
                    {!n.readAt && (
                      <button
                        type="button"
                        className="text-gray-500 hover:text-gray-800"
                        onClick={() => markReadMutation.mutate(n.id)}
                      >
                        읽음
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
