import { useEffect, useRef, useState } from "react";

const DURATION = 450;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Smoothly transitions between a previous and a new numeric value.
 * The first render shows the value immediately (no count-up on navigation);
 * only later changes animate.
 */
export function useAnimatedValue(value: number) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value) return;

    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value]);

  return display;
}

export function AnimatedMoney({
  value,
  currency,
  format,
  className,
}: {
  value: number;
  currency: string;
  format: (amount: number, currency: string) => string;
  className?: string;
}) {
  const display = useAnimatedValue(value);
  return <span className={className}>{format(display, currency)}</span>;
}
