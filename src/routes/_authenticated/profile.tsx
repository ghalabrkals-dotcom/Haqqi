import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/haqqi/app-shell";
import { PlusBadge } from "@/components/haqqi/plus";
import { useSubscription } from "@/lib/subscription";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Haqqi" },
      { name: "description", content: "Your Haqqi account preferences, currency and settings." },
      { property: "og:title", content: "Profile — Haqqi" },
      { property: "og:description", content: "Manage your Haqqi preferences and default currency." },
    ],
  }),
  component: Profile,
});

const groups = [
  {
    title: "Preferences",
    items: ["Default currency", "Date format", "Language"],
    values: ["KWD — Kuwaiti Dinar", "DD / MM / YYYY", "English"],
  },
  {
    title: "Coming soon",
    items: ["Reminders", "Bank connections", "Export history"],
    values: ["Later step", "Later step", "Later step"],
  },
];

function initials(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "H";
}

function Profile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<{ full_name: string; email: string; created_at: string } | null>(
    null,
  );
  const [signingOut, setSigningOut] = useState(false);
  const { isPlus, loading: planLoading } = useSubscription();

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: row } = await supabase
        .from("profiles")
        .select("full_name, email, created_at")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!active) return;
      setProfile({
        full_name: row?.full_name || (data.user.user_metadata?.["full_name"] as string) || "",
        email: row?.email || data.user.email || "",
        created_at: row?.created_at || data.user.created_at,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth/signin", replace: true });
  }

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "—";

  return (
    <AppShell>
      <PageHeader title="Profile" subtitle="Your account and preferences." />

      <div className="surface-card mt-7 flex flex-wrap items-center gap-4 p-6">
        <span className="grid size-14 place-items-center rounded-full bg-primary font-display text-xl text-primary-foreground">
          {profile ? initials(profile.full_name, profile.email) : "…"}
        </span>
        <div className="min-w-0">
          <p className="text-[19px] font-semibold tracking-tight">{profile?.full_name || "Your account"}</p>
          <p className="text-sm text-muted-foreground">{profile?.email ?? ""}</p>
          <p className="text-xs text-muted-foreground">Member since {memberSince}</p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="ml-auto inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          <LogOut className="size-4" />
          {signingOut ? "Signing out…" : "Sign Out"}
        </button>
      </div>

      <section className="surface-card mt-7 overflow-hidden">
        <h2 className="flex items-center gap-2.5 border-b border-border px-6 py-4 font-display text-[15px]">
          Subscription
        </h2>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between gap-3 px-6 py-4 text-sm">
            <span className="font-medium">Current plan</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {planLoading ? "…" : isPlus ? "Haqqi Plus" : "Free"}
              {!planLoading && isPlus ? <PlusBadge /> : null}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 px-6 py-4 text-sm">
            <span className="font-medium">Billing status</span>
            <span className="text-muted-foreground">
              {planLoading ? "…" : isPlus ? "Active" : "No active subscription"}
            </span>
          </div>
          <Link
            to="/plans"
            className="flex w-full items-center justify-between px-6 py-4 text-left text-sm transition-colors hover:bg-muted"
          >
            <span className="font-medium">Manage Plan</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </div>
      </section>

      <div className="mt-7 grid gap-6 xl:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} className="surface-card overflow-hidden">
            <h2 className="flex items-center gap-2.5 border-b border-border px-6 py-4 font-display text-[15px]">
              {g.title}
            </h2>
            <div className="divide-y divide-border">
              {g.items.map((item, i) => (
                <button
                  key={item}
                  type="button"
                  className="flex w-full items-center justify-between px-6 py-4 text-left text-sm transition-colors hover:bg-muted"
                >
                  <span className="font-medium">{item}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {g.values[i]}
                    <ChevronRight className="size-4" />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
