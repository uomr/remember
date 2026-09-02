import { SignInForm } from '@/components/auth/SignInForm';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

/**
 * Sign-in screen. Calm, mobile-first, single purpose: get a sign-in link.
 * Features Fraunces variable brand typography and soft warm mesh backdrop.
 */
export default function SignInPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const initialError =
    searchParams.error === 'auth'
      ? "That sign-in link didn't work. Please request a new one."
      : undefined;

  return (
    <div className="relative min-h-dvh w-full sign-mesh-wrapper overflow-hidden bg-surface">
      {/* Warm lightweight gradient backdrop */}
      <div className="absolute inset-0 signin-mesh-bg opacity-90 pointer-events-none" aria-hidden="true" />

      <main className="relative mx-auto flex min-h-dvh max-w-content flex-col justify-center px-6 py-18">
        <div className="absolute top-6 right-6">
          <ThemeToggle />
        </div>

        <header className="mb-10">
          <h1 className="font-brand-title text-4xl sm:text-[2.75rem] leading-none tracking-tight text-ink">
            Remember
          </h1>
          <p className="mt-4 text-lg text-ink-muted leading-relaxed">
            Never lose something again. Save anything important, find it later using what you
            remember.
          </p>
        </header>

        <section className="space-y-6">
          <SignInForm initialError={initialError} />
        </section>

        <p className="mt-12 text-sm text-ink-faint">
          We&apos;ll email you a secure link — no password to remember.
        </p>
      </main>
    </div>
  );
}

