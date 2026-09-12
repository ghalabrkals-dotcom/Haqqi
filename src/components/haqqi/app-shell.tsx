import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LayoutGrid, PlusCircle, Activity, ArrowLeftRight, PieChart, User, Star } from "lucide-react";
import { PlusBadge } from "@/components/haqqi/plus";
import { useSubscription } from "@/lib/subscription";
import { NotificationBell } from "@/components/haqqi/notification-bell";
import { HaqqiLogo } from "@/components/haqqi/logo";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/track", label: "Track Money", icon: PlusCircle },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/match", label: "Match", icon: ArrowLeftRight },
  { to: "/insights", label: "Insights", icon: PieChart },
  { to: "/profile", label: "Profile", icon: User },
] as const;

const sidebarNav = [
  ...nav,
  { to: "/plans", label: "Plans", icon: Star },
] as const;

// Features that need Haqqi Plus; Free users still see them, with a subtle marker.
const plusRoutes = new Set(["/match", "/insights"]);

const navBase =
  "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-[color,background-color] duration-200 ease-out";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isPlus, loading: planLoading } = useSubscription();
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-sidebar px-4 py-6 lg:flex">
          <div className="flex items-start justify-between gap-2 px-1">
            <Link to="/dashboard">
              <HaqqiLogo />
            </Link>
            <NotificationBell align="left" />
          </div>

          <nav className="mt-9 flex flex-1 flex-col gap-0.5">
            {sidebarNav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`${navBase} text-muted-foreground hover:bg-accent/60 hover:text-foreground`}
                activeProps={{
                  className: `${navBase} bg-accent/70 text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-full before:bg-primary`,
                }}
              >
                <Icon className="size-[17px] shrink-0" strokeWidth={1.75} />
                {label}
                {!planLoading && !isPlus && plusRoutes.has(to) ? (
                  <PlusBadge className="ml-auto" />
                ) : null}
              </Link>
            ))}
          </nav>

          <p className="px-3 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
            KWD · Kuwait
          </p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
            <Link to="/dashboard">
              <HaqqiLogo compact />
            </Link>
            <div className="flex items-center gap-2">
              <NotificationBell />
            </div>
          </header>

          <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-9">
            <div key={pathname} className="page-enter">
              {children}
            </div>
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-card/95 backdrop-blur lg:hidden">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center gap-1 py-2.5 text-[9.5px] font-medium text-muted-foreground transition-colors duration-200"
            activeProps={{
              className:
                "flex flex-col items-center gap-1 py-2.5 text-[9.5px] font-medium text-primary transition-colors duration-200",
            }}
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[19px] font-semibold tracking-tight sm:text-[21px]">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function SectionHeading({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2.5">
      <h2 className="section-label">{title}</h2>
      {aside}
    </div>
  );
}
