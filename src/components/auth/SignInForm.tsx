'use client';

import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/**
 * Low-friction sign-in: email magic link (OTP). We deliberately avoid
 * passwords for the MVP. On submit we ask Supabase to email a sign-in link
 * that returns to /auth/callback, then show a calm "check your email" state.
 *
 * Errors are surfaced in human language — never a raw code.
 */
export function SignInForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(initialError ?? null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus('sending');
    setMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setStatus('error');
        setMessage("We couldn't send your link right now. Please try again in a moment.");
        return;
      }

      setStatus('sent');
    } catch {
      setStatus('error');
      setMessage("We couldn't send your link right now. Please try again in a moment.");
    }
  }

  if (status === 'sent') {
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <h2 className="text-xl font-semibold text-ink">Check your email</h2>
        <p className="text-ink-muted">
          We sent a sign-in link to <span className="font-medium text-ink">{email.trim()}</span>.
          Open it on this device to continue.
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus('idle');
            setMessage(null);
          }}
          className="text-sm font-medium text-accent hover:text-accent-hover"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === 'sending'}
      />

      {message ? (
        <p className="text-sm text-ink-muted" role="alert">
          {message}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send me a link'}
      </Button>
    </form>
  );
}
