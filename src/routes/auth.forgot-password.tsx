import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, Field, PrimaryButton, FormAlert } from "@/components/haqqi/auth-layout";

export const Route = createFileRoute("/auth/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your Haqqi password" },
      { name: "description", content: "Request a password reset link for your Haqqi account." },
      { property: "og:title", content: "Reset your Haqqi password" },
      { property: "og:description", content: "We'll email you a link to set a new password." },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout
      title="Forgot Password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link to="/auth/signin" className="font-semibold text-primary underline-offset-4 hover:underline">
          Back to Sign In
        </Link>
      }
    >
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {sent ? (
        <FormAlert tone="success">
          If an account exists for {email.trim()}, a reset link is on its way.
        </FormAlert>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Email Address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "Sending…" : "Send Reset Link"}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
