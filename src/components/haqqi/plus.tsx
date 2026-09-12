import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Lock } from "lucide-react";

export function PlusBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border border-primary/30 bg-primary/8 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-primary ${className}`}
    >
      Plus
    </span>
  );
}

/** Clean locked state shown to Free users instead of a premium feature. */
export function UpgradeNotice({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rise flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex items-center gap-2">
        <Lock className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
        <PlusBadge />
      </div>
      <p className="max-w-prose text-[13px] text-muted-foreground">{description}</p>
      {children}
      <div>
        <Link
          to="/plans"
          className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-[0.985]"
        >
          View Haqqi Plus
        </Link>
      </div>
    </div>
  );
}

/** Free-plan limit dialog. Never a technical error. */
export function LimitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fade-enter absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="limit-title"
        className="rise relative w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <h2 id="limit-title" className="text-[16px] font-semibold tracking-tight">
          You’ve reached your Free plan limit.
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Upgrade to Haqqi Plus to track unlimited money owed to you.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold transition-colors duration-200 hover:bg-muted active:scale-[0.985]"
          >
            Not Now
          </button>
          <Link
            to="/plans"
            className="rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-[0.985]"
          >
            View Haqqi Plus
          </Link>
        </div>
      </div>
    </div>
  );
}
