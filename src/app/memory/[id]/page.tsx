import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMemory } from '@/lib/memories/queries';
import { DeleteMemoryButton } from '@/components/memories/DeleteMemoryButton';
import { formatFileSize, formatMemoryDate } from '@/lib/format';

/**
 * Memory detail. Shows the original content (image, document link, saved link,
 * or note), basic metadata, and a delete control. Signed file URLs are minted
 * server-side in getMemory(). RLS guarantees the user can only open their own.
 */
export const dynamic = 'force-dynamic';

import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default async function MemoryPage({ params }: { params: { id: string } }) {
  const memory = await getMemory(params.id);
  if (!memory) notFound();

  const date = formatMemoryDate(memory.created_at);

  return (
    <main className="mx-auto flex min-h-dvh max-w-content flex-col px-6 py-12 animate-rise-in">
      <header className="mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded transition-colors"
        >
          ← Back
        </Link>
        <ThemeToggle />
      </header>

      <article className="space-y-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-faint">
          <span>{memory.type}</span>
          <span aria-hidden>·</span>
          <span>{date}</span>
        </div>

        {memory.title ? (
          <h1 dir="auto" className="text-xl font-semibold text-ink leading-snug">{memory.title}</h1>
        ) : null}

        {memory.type === 'image' && memory.fileUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={memory.fileUrl}
            alt={memory.title ?? 'Saved image'}
            className="w-full rounded-2xl border border-border"
          />
        ) : null}

        {memory.type === 'document' && memory.fileUrl ? (
          <a
            href={memory.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-5 py-4 text-base font-medium text-ink shadow-soft transition-colors hover:border-border-strong"
          >
            Open document
            {memory.file?.file_size != null ? (
              <span className="text-sm text-ink-faint">
                ({formatFileSize(memory.file.file_size)})
              </span>
            ) : null}
          </a>
        ) : null}

        {memory.type === 'link' && memory.url ? (
          <a
            href={memory.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate rounded-xl border border-border bg-surface-raised px-5 py-4 text-base text-accent shadow-soft transition-colors hover:border-border-strong"
          >
            {memory.url}
          </a>
        ) : null}

        {memory.type === 'note' && memory.text_content ? (
          <p dir="auto" className="whitespace-pre-line text-lg leading-relaxed text-ink">
            {memory.text_content}
          </p>
        ) : null}

        {/* Optional caption/note attached to an image or document. */}
        {(memory.type === 'image' || memory.type === 'document') && memory.text_content ? (
          <p dir="auto" className="whitespace-pre-line leading-relaxed text-ink-muted">
            {memory.text_content}
          </p>
        ) : null}

        <div className="border-t border-border pt-6">
          <DeleteMemoryButton memoryId={memory.id} />
        </div>
      </article>
    </main>
  );
}
