'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createMemory } from '@/app/actions/memories';
import { enrichImageMemory, enrichGenericMemory } from '@/app/actions/enrich';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';

type CaptureKind = 'note' | 'link' | 'image' | 'document';

const KINDS: { key: CaptureKind; label: string; hint: string }[] = [
  { key: 'image', label: 'Photo or screenshot', hint: 'Upload an image' },
  { key: 'document', label: 'Document', hint: 'PDF or text file' },
  { key: 'link', label: 'Link', hint: 'Save a web page' },
  { key: 'note', label: 'Note', hint: 'Write something down' },
];

export function CaptureButton() {
  const router = useRouter();
  const { showToast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CaptureKind | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [initialUrl, setInitialUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  function reset() {
    setKind(null);
    setError(null);
    setInitialUrl('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedImage(null);
    setPreviewUrl(null);
  }

  function handleImageSelected(file: File | null) {
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  // Keyboard accessibility: Escape key to go back or close modal
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) {
        e.preventDefault();
        if (kind) {
          reset();
        } else {
          close();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, kind, pending]);

  // Global Drag & Drop capture (P1.10)
  useEffect(() => {
    let dragCounter = 0;

    function onDragEnter(e: DragEvent) {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsDragging(true);
      }
    }

    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setIsDragging(false);
      }
    }

    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }

    function onDrop(e: DragEvent) {
      e.preventDefault();
      dragCounter = 0;
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      if (!file) return;

      const isImg = file.type.startsWith('image/');
      const selectedKind: CaptureKind = isImg ? 'image' : 'document';

      setKind(selectedKind);
      setOpen(true);

      if (isImg) {
        handleImageSelected(file);
      } else {
        // Pre-fill file input for documents
        setTimeout(() => {
          if (fileInputRef.current && e.dataTransfer) {
            fileInputRef.current.files = e.dataTransfer.files;
          }
        }, 50);
      }
    }

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Global Clipboard paste → auto Link capture (P1.11)
  useEffect(() => {
    async function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        const activeEl = document.activeElement;
        const isEditing =
          activeEl?.tagName === 'INPUT' ||
          activeEl?.tagName === 'TEXTAREA' ||
          activeEl?.getAttribute('contenteditable') === 'true';

        if (isEditing) return;

        try {
          const text = await navigator.clipboard.readText();
          const trimmed = text.trim();
          if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
            e.preventDefault();
            setKind('link');
            setInitialUrl(trimmed);
            setOpen(true);
          }
        } catch {
          // Ignore clipboard read permission failures
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind) return;
    setError(null);

    const formData = new FormData(event.currentTarget);
    formData.set('type', kind);

    if (kind === 'image') {
      if (!selectedImage) {
        setError('Please select or take a photo first.');
        return;
      }
      formData.set('file', selectedImage);
    }

    const savingKind = kind;

    startTransition(async () => {
      const result = await createMemory(formData);
      if (result.ok) {
        close();
        showToast('Remembered');

        // Track capture count for PWA prompt (P1.13)
        try {
          const cur = parseInt(localStorage.getItem('remember_captures_count') || '0', 10) + 1;
          localStorage.setItem('remember_captures_count', String(cur));
          window.dispatchEvent(new Event('remember_captured'));
        } catch {
          // Ignore storage error
        }

        router.refresh();

        if (result.memoryId) {
          const id = result.memoryId;
          if (savingKind === 'image') {
            void enrichImageMemory(id).then(() => router.refresh());
          } else if (savingKind === 'document') {
            // enrichDocumentMemory is already invoked on the server by createMemory.
            // Avoid duplicate parallel calls.
            router.refresh();
          } else {
            void enrichGenericMemory(id).then(() => router.refresh());
          }
        }
      } else {
        setError(result.error ?? 'Something went wrong. Please try again.');
      }
    });
  }

  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        + Remember something
      </Button>

      {/* Global Drag & Drop Overlay (P1.10) */}
      {mounted && isDragging
        ? createPortal(
            <div
              aria-hidden="true"
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm border-2 border-dashed border-accent pointer-events-none transition-all duration-150 animate-in fade-in"
            >
              <div className="rounded-2xl border border-accent/40 bg-surface-raised px-8 py-6 shadow-soft text-center" dir="auto">
                <p className="text-xl font-semibold text-accent">Drop to remember</p>
                <p className="text-sm text-ink-muted mt-1">أفلت لتحفظ</p>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* Capture Modal / Bottom Sheet with iOS curve (P1.7) */}
      {mounted && open
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm p-0 sm:items-center sm:p-6 animate-in fade-in duration-200"
              role="dialog"
              aria-modal="true"
              aria-label="Remember something"
              onClick={(e) => {
                if (e.target === e.currentTarget && !pending) close();
              }}
            >
              <div className="w-full max-w-content rounded-t-2xl bg-surface-raised p-6 shadow-2xl border border-border sm:rounded-2xl animate-in slide-in-from-bottom duration-300 sm:slide-in-from-bottom-0 sm:zoom-in-95 sm:duration-200">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-ink">
                    {kind ? 'Save it' : 'What do you want to remember?'}
                  </h2>
                  <button
                    type="button"
                    onClick={close}
                    disabled={pending}
                    className="rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-surface-sunken disabled:opacity-50 transition-colors"
                    aria-label="Close"
                  >
                    Close
                  </button>
                </div>

                {!kind ? (
                  <ul className="space-y-2">
                    {KINDS.map((k) => (
                      <li key={k.key}>
                        <button
                          type="button"
                          onClick={() => setKind(k.key)}
                          className="flex w-full items-baseline justify-between rounded-xl border border-border bg-surface px-5 py-4 text-left transition-colors hover:border-border-strong hover:bg-surface-sunken active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <span className="text-base font-medium text-ink">{k.label}</span>
                          <span className="text-sm text-ink-faint">{k.hint}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
                    {kind === 'note' ? (
                      <div className="space-y-2">
                        <label htmlFor="note-text" className="block text-sm font-medium text-ink">
                          Note
                        </label>
                        <textarea
                          id="note-text"
                          name="text"
                          dir="auto"
                          required
                          rows={5}
                          autoFocus
                          placeholder="Anything you want to remember later…"
                          className="w-full rounded-2xl border border-border bg-surface-raised px-5 py-4 text-base text-ink placeholder:text-ink-faint shadow-soft transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                        />
                      </div>
                    ) : null}

                    {kind === 'link' ? (
                      <div className="space-y-4">
                        <TextField
                          label="Link"
                          name="url"
                          type="url"
                          inputMode="url"
                          defaultValue={initialUrl}
                          required
                          autoFocus={!initialUrl}
                          placeholder="https://…"
                        />
                        <div className="space-y-2">
                          <label htmlFor="link-note" className="block text-sm font-medium text-ink">
                            Add a note <span className="font-normal text-ink-faint">(optional)</span>
                          </label>
                          <textarea
                            id="link-note"
                            name="text"
                            dir="auto"
                            rows={2}
                            autoFocus={Boolean(initialUrl)}
                            placeholder="Why are you saving this link?"
                            className="w-full rounded-2xl border border-border bg-surface-raised px-5 py-4 text-base text-ink placeholder:text-ink-faint shadow-soft transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                          />
                        </div>
                      </div>
                    ) : null}

                    {kind === 'image' ? (
                      <div className="space-y-3">
                        <input
                          ref={cameraInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          onChange={(e) => handleImageSelected(e.target.files?.[0] ?? null)}
                        />
                        <input
                          ref={galleryInputRef}
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => handleImageSelected(e.target.files?.[0] ?? null)}
                        />

                        {!selectedImage ? (
                          <div className="space-y-3">
                            <label className="block text-sm font-medium text-ink">
                              Photo
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <button
                                type="button"
                                onClick={() => cameraInputRef.current?.click()}
                                className="flex items-center justify-center gap-2.5 rounded-2xl border border-border bg-surface px-5 py-4 text-ink hover:bg-surface-sunken hover:border-border-strong active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <svg
                                  className="h-5 w-5 text-accent shrink-0"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={1.5}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                                  />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                                  />
                                </svg>
                                <span className="font-medium text-base">Take photo</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => galleryInputRef.current?.click()}
                                className="flex items-center justify-center gap-2.5 rounded-2xl border border-border bg-surface px-5 py-4 text-ink hover:bg-surface-sunken hover:border-border-strong active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <svg
                                  className="h-5 w-5 text-accent shrink-0"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={1.5}
                                >
                                  <rect x="3" y="3" width="18" height="18" rx="4" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M21 15l-5-5L5 21"
                                  />
                                </svg>
                                <span className="font-medium text-base">Choose from photos</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-sunken max-h-56 flex items-center justify-center">
                              {previewUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={previewUrl}
                                  alt="Chosen photo preview"
                                  className="max-h-56 w-full object-contain"
                                />
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedImage(null);
                                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                                  setPreviewUrl(null);
                                }}
                                className="absolute top-2 right-2 rounded-lg bg-black/60 backdrop-blur-sm px-2.5 py-1 text-xs text-white/90 hover:bg-black/80 transition-colors"
                              >
                                Change
                              </button>
                            </div>
                            <p className="text-xs text-ink-muted truncate">
                              {selectedImage.name} ({Math.round(selectedImage.size / 1024)} KB)
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {kind === 'document' ? (
                      <div className="space-y-2">
                        <label htmlFor="capture-file" className="block text-sm font-medium text-ink">
                          Document
                        </label>
                        <input
                          ref={fileInputRef}
                          id="capture-file"
                          name="file"
                          type="file"
                          required
                          accept=".pdf,.txt,.md,.doc,.docx"
                          className="block w-full text-sm text-ink-muted file:mr-4 file:rounded-xl file:border-0 file:bg-accent-soft dark:file:bg-accent-soft-dark file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent hover:file:bg-border"
                        />
                      </div>
                    ) : null}

                    {kind === 'image' || kind === 'document' ? (
                      <div className="space-y-2">
                        <label htmlFor="capture-note" className="block text-sm font-medium text-ink">
                          Add a note{' '}
                          <span className="font-normal text-ink-faint">(optional)</span>
                        </label>
                        <textarea
                          id="capture-note"
                          name="text"
                          dir="auto"
                          rows={3}
                          placeholder="Describe it in your own words so you can find it later…"
                          className="w-full rounded-2xl border border-border bg-surface-raised px-5 py-4 text-base text-ink placeholder:text-ink-faint shadow-soft transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                        />
                      </div>
                    ) : null}

                    {error ? (
                      <p className="text-sm text-ink-muted" role="alert">
                        {error}
                      </p>
                    ) : null}

                    <div className="flex items-center gap-3">
                      <Button type="submit" disabled={pending}>
                        {pending ? 'Saving…' : 'Save'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={reset}
                        disabled={pending}
                        className="px-3 py-2 text-sm"
                      >
                        Back
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

