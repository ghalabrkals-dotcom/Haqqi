export function HaqqiMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Circular return movement — money coming back */}
      <path
        d="M26.4 16.6a10.4 10.4 0 1 1-3.5-7.4"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M26.6 4.6v5.6h-5.6"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Subtle H — ownership */}
      <path
        d="M12.2 11.2v9.9M19.9 11.2v9.9M12.2 16.1h7.7"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HaqqiLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground">
        <HaqqiMark className="size-[18px]" />
      </span>
      <span className="leading-none">
        <span className="block font-display text-[19px] tracking-tight">Haqqi</span>
        {compact ? null : (
          <span className="mt-1 block whitespace-nowrap text-[8.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            What you are owed
          </span>
        )}
      </span>
    </span>
  );
}
