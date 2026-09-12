import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, Field, PrimaryButton, FormAlert } from "@/components/haqqi/auth-layout";

export const Route = createFileRoute("/auth/signin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in to Haqqi" },
      { name: "description", content: "Sign in to see the refunds, deposits and money owed to you." },
      { property: "og:title", content: "Sign in to Haqqi" },
      { property: "og:description", content: "Your personal receivables, tracked in KWD." },
    ],
  }),
  component: SignIn,
});

type Errors = Partial<Record<"email" | "password" | "form", string>>;

function SignIn() {
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!values.email.trim()) next.email = "Please enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
      next.email = "That doesn't look like a valid email address.";
    if (!values.password) next.password = "Please enter your password.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    });
    setLoading(false);

    if (error) {
      setErrors({
        form:
          error.message === "Invalid login credentials"
            ? "That email and password don't match an account."
            : error.message,
      });
      return;
    }
    navigate({ to: "/dashboard" });
  }

  return (
    <AuthLayout
      title="Sign In"
      subtitle="Welcome back to your money."
      footer={
        <>
          Don't have an account?{" "}
          <Link to="/auth/signup" className="font-semibold text-primary underline-offset-4 hover:underline">
            Create Account
          </Link>
        </>
      }
    >
      {errors.form ? <FormAlert tone="error">{errors.form}</FormAlert> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Email Address"
          type="email"
          value={values.email}
          onChange={set("email")}
          placeholder="you@example.com"
          error={errors.email}
          autoComplete="email"
        />
        <Field
          label="Password"
          type="password"
          value={values.password}
          onChange={set("password")}
          placeholder="Your password"
          error={errors.password}
          autoComplete="current-password"
        />
        <div className="flex justify-end">
          <Link
            to="/auth/forgot-password"
            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            Forgot Password?
          </Link>
        </div>
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign In"}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
