export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-800/80 bg-[#0e0c0a]/60 px-4 py-5 text-xs sm:text-sm text-stone-400">
      <p className="font-semibold text-stone-200 text-xs sm:text-sm">{title}</p>
      <p className="mt-1 text-xs text-stone-400 leading-relaxed">{children}</p>
    </div>
  );
}
