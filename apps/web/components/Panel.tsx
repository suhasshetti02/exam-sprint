import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  /** Honest implementation label shown beside the title. */
  badge?: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, badge, icon, headerAction, children, className = "" }: PanelProps) {
  return (
    <section
      className={`warm-glass-panel rounded-2xl p-4 sm:p-5 shadow-xl transition-all ${className}`}
      aria-label={title}
    >
      <div className="mb-3.5 flex items-center justify-between gap-3 border-b border-stone-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="text-amber-400 bg-amber-500/10 border border-amber-500/20 p-1.5 rounded-lg flex items-center justify-center text-sm">
              {icon}
            </span>
          )}
          <h2 className="text-xs sm:text-sm font-semibold tracking-tight text-stone-100 uppercase flex items-center gap-2">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {badge ? (
            <span className="text-[11px] font-mono text-stone-400 bg-stone-900/80 px-2 py-0.5 rounded-full border border-stone-800/80">
              {badge}
            </span>
          ) : null}
          {headerAction}
        </div>
      </div>
      {children}
    </section>
  );
}
