'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { updateMemory } from '@/app/actions/memories';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { MemoryWithFile } from '@/lib/memories/queries';

interface EditMemoryDialogProps {
  memory: MemoryWithFile;
}

export function EditMemoryDialog({ memory }: EditMemoryDialogProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Extract user-authored note portion (first part before machine description)
  const fullText = memory.text_content ?? '';
  const initialNote = memory.type === 'note' ? fullText : (fullText.split('\n\n')[0] ?? '');
  const initialTitle = memory.title ?? '';

  const [title, setTitle] = useState(initialTitle);
  const [note, setNote] = useState(initialNote);

  function handleOpen() {
    setTitle(memory.title ?? '');
    const text = memory.text_content ?? '';
    setNote(memory.type === 'note' ? text : (text.split('\n\n')[0] ?? ''));
    setError(null);
    setOpen(true);
  }

  function handleClose() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set('id', memory.id);
    formData.set('title', title.trim());
    formData.set('text', note.trim());

    startTransition(async () => {
      const res = await updateMemory(formData);
      if (res.ok) {
        showToast('Memory updated');
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? 'Failed to save changes. Please try again.');
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-sunken"
        id="edit-memory-btn"
      >
        <svg
          className="h-4 w-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
          />
        </svg>
        <span>Edit</span>
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm p-0 sm:items-center sm:p-6 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-dialog-title"
        >
          <div className="w-full max-w-lg rounded-t-3xl border border-border bg-surface p-6 sm:rounded-2xl shadow-elevated transition-all">
            <div className="flex items-center justify-between mb-5">
              <h2 id="edit-dialog-title" className="text-lg font-semibold text-ink">
                Edit memory
              </h2>
              <button
                type="button"
                onClick={handleClose}
                disabled={pending}
                className="rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-surface-sunken disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error ? (
                <div
                  className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
                  role="alert"
                >
                  {error}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="edit-title" className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
                  Title
                </label>
                <input
                  id="edit-title"
                  name="title"
                  type="text"
                  dir="auto"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={memory.type === 'note' ? 'Title derived from note…' : 'Name or title…'}
                  className="w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-base text-ink placeholder:text-ink-faint shadow-soft transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="edit-note" className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
                  {memory.type === 'note' ? 'Note text' : 'Note / Description'}
                </label>
                <textarea
                  id="edit-note"
                  name="text"
                  dir="auto"
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    memory.type === 'image'
                      ? 'Add notes about this photo (e.g. سير دركسون لأكسنت 2018 — مستعمل)…'
                      : memory.type === 'document'
                      ? 'Add notes about this document…'
                      : 'Anything you want to remember later…'
                  }
                  className="w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-base text-ink placeholder:text-ink-faint shadow-soft transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClose}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pending}
                  id="save-memory-edit-btn"
                >
                  {pending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
