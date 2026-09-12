import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout, Field, PrimaryButton, FormAlert } from "@/components/haqqi/auth-layout";

export const Route = createFileRoute("/auth/signup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create your Haqqi account" },
      { name: "description", content: "Sign up to start tracking the money that should come back to you." },
      { property: "og:title", content: "Create your Haqqi account" },
      { property: "og:description", content: "Track refunds, deposits and money owed to you in KWD." },
    ],
  }),
  component: SignUp,
});

type Errors = Partial<Record<"fullName" | "email" | "password" | "confirm" | "form", string>>;

function SignUp() {
  const navigate = useNavigate();
  const [values, setValues] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!values.fullName.trim()) next.fullName = "Please enter your full name.";
    if (!values.email.trim()) next.email = "Please enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
      next.email = "That doesn't look like a valid email address.";
    if (!values.password) next.password = "Please choose a password.";
    else if (values.password.length < 8) next.password = "Use at least 8 characters.";
    if (!values.confirm) next.confirm = "Please confirm your password.";
    else if (values.confirm !== values.password) next.confirm = "The two passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: {
        emailRedirectTo: `${window.location.origin}/welcome`,
        data: { full_name: values.fullName.trim() },
      },
    });
    setLoading(false);

    if (error) {
      setErrors({ form: error.message });
      return;
    }
    if (data.session) {
      navigate({ to: "/welcome" });
      return;
    }
    setCheckEmail(true);
  }

  if (checkEmail) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle={`We sent a confirmation link to ${values.email.trim()}. Open it to activate your Haqqi account.`}
      >
        <Link
          to="/auth/signin"
          className="block w-full rounded-md bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground"
        >
          Back to Sign In
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Start tracking every dinar that should come back to you."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/auth/signin" className="font-semibold text-primary underline-offset-4 hover:underline">
            Sign In
          </Link>
        </>
      }
    >
      {errors.form ? <FormAlert tone="error">{errors.form}</FormAlert> : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Full Name"
          value={values.fullName}
          onChange={set("fullName")}
          placeholder="Ghala Alsejari"
          error={errors.fullName}
          autoComplete="name"
        />
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
          placeholder="At least 8 characters"
          error={errors.password}
          autoComplete="new-password"
        />
        <Field
          label="Confirm Password"
          type="password"
          value={values.confirm}
          onChange={set("confirm")}
          placeholder="Repeat your password"
          error={errors.confirm}
          autoComplete="new-password"
        />
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "Creating account…" : "Create Account"}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
