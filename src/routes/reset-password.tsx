import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, Field, PrimaryButton, FormAlert } from "@/components/haqqi/auth-layout";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new Haqqi password" },
      { name: "description", content: "Choose a new password for your Haqqi account." },
      { property: "og:title", content: "Set a new Haqqi password" },
      { property: "og:description", content: "Finish resetting your Haqqi password." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const isRecovery = hash.includes("type=recovery");
    supabase.auth.getSession().then(({ data }) => {
      if (isRecovery || data.session) setReady(true);
      else setError("This reset link is invalid or has expired. Please request a new one.");
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (values.password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (values.password !== values.confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setError(null);
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: values.password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    setTimeout(() => navigate({ to: "/dashboard" }), 1200);
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose something you'll remember.">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {done ? <FormAlert tone="success">Password updated. Taking you to your dashboard…</FormAlert> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="New Password"
          type="password"
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
          autoComplete="new-password"
        />
        <Field
          label="Confirm New Password"
          type="password"
          value={values.confirm}
          onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))}
          autoComplete="new-password"
        />
        <PrimaryButton type="submit" disabled={loading || !ready || done}>
          {loading ? "Updating…" : "Update Password"}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
