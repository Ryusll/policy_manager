export function LoadingBlock({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3" role="status" aria-live="polite">
      <div className="h-8 w-8 rounded-full border-2 border-navy-200 border-t-navy-700 animate-spin" />
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}
