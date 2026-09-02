'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteMemory } from '@/app/actions/memories';
import { Button } from '@/components/ui/Button';

/**
 * Delete control with a lightweight confirm step. On success we leave the
 * detail screen; on failure we show a calm, retryable message and keep the
 * memory in place (we never pretend it was deleted).
 */
export function DeleteMemoryButton({ memoryId }: { memoryId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteMemory(memoryId);
      if (result.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError(result.error ?? "We couldn't delete this right now. Please try again.");
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="ghost"
          className="text-sm text-ink-muted"
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
        {error ? (
          <p className="text-sm text-ink-muted" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface-raised p-4">
      <p className="text-sm text-ink">Delete this memory? This can’t be undone.</p>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          className="bg-ink text-white hover:bg-ink/90"
          onClick={handleDelete}
          disabled={pending}
        >
          {pending ? 'Deleting…' : 'Yes, delete'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="px-3 py-2 text-sm"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Keep it
        </Button>
      </div>
    </div>
  );
}
