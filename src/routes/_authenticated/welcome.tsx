import { createFileRoute, Link } from "@tanstack/react-router";
import { HaqqiMark } from "@/components/haqqi/logo";

export const Route = createFileRoute("/_authenticated/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to Haqqi" },
      { name: "description", content: "Your Haqqi account is ready. Start tracking what you're owed." },
      { property: "og:title", content: "Welcome to Haqqi" },
      { property: "og:description", content: "Keep track of every dinar that should come back to you." },
    ],
  }),
  component: Welcome,
});

function Welcome() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-[16px] bg-primary text-primary-foreground">
          <HaqqiMark className="size-7" />
        </span>
        <h1 className="mt-6 text-[26px] font-semibold tracking-tight sm:text-[30px]">Welcome to Haqqi</h1>
        <p className="mx-auto mt-4 max-w-sm text-sm text-muted-foreground">
          Keep track of every dinar that should come back to you.
        </p>
        <Link
          to="/dashboard"
          className="mt-8 inline-flex items-center justify-center rounded-md bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Start Tracking
        </Link>
      </div>
    </div>
  );
}
