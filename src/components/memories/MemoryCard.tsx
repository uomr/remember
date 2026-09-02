import Link from 'next/link';
import type { MemoryWithFile } from '@/lib/memories/queries';
import { formatMemoryDate } from '@/lib/format';

/**
 * A single memory, rendered to feel like something the user saved — not a file
 * row. Features custom stroke SVG icons, quiet left-border accents, and bilingual RTL.
 */
export function MemoryCard({
  memory,
  className = '',
  style,
}: {
  memory: MemoryWithFile;
  className?: string;
  style?: React.CSSProperties;
}) {
  const date = formatMemoryDate(memory.created_at);

  const typeBorderClass = {
    image: 'border-l-[3px] border-l-[#2f6d5f]/40 dark:border-l-[#3f9382]/50',
    note: 'border-l-[3px] border-l-[#2f6d5f]/25 dark:border-l-[#3f9382]/35',
    link: 'border-l-[3px] border-l-[#2f6d5f]/55 dark:border-l-[#3f9382]/65',
    document: 'border-l-[3px] border-l-[#2f6d5f]/70 dark:border-l-[#3f9382]/80',
  }[memory.type];

  return (
    <Link
      href={`/memory/${memory.id}`}
      style={style}
      className={`group block overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-soft transition-all duration-150 hover:border-border-strong hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${typeBorderClass} ${className}`}
    >
      {memory.type === 'image' && memory.fileUrl ? (
        <div className="aspect-video w-full bg-surface-sunken overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={memory.fileUrl}
            alt={memory.title ?? 'Saved image'}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        </div>
      ) : null}

      <div className="space-y-1.5 p-5">
        <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-ink-faint">
          <div className="flex items-center gap-1.5 text-accent">
            {iconForType(memory.type)}
            <span className="font-medium text-[11px]">{labelForType(memory.type)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span aria-hidden>·</span>
            <span>{date}</span>
          </div>
        </div>

        {memory.type === 'note' ? (
          <p dir="auto" className="line-clamp-3 whitespace-pre-line text-base text-ink leading-relaxed">
            {memory.text_content}
          </p>
        ) : (
          <p dir="auto" className="line-clamp-2 text-base font-medium text-ink leading-snug">
            {memory.title ?? untitledForType(memory.type)}
          </p>
        )}

        {/* Caption or description preview for files if title is generic */}
        {(memory.type === 'image' || memory.type === 'document') && memory.text_content ? (
          <p dir="auto" className="line-clamp-2 text-sm text-ink-muted leading-relaxed">
            {memory.text_content}
          </p>
        ) : null}

        {memory.type === 'link' && memory.url ? (
          <p className="truncate text-sm text-ink-muted">{memory.url}</p>
        ) : null}
      </div>
    </Link>
  );
}

function iconForType(type: MemoryWithFile['type']) {
  switch (type) {
    case 'image':
      return (
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21" />
        </svg>
      );
    case 'note':
      return (
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
          />
        </svg>
      );
    case 'link':
      return (
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.357l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
          />
        </svg>
      );
    case 'document':
      return (
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
      );
  }
}

function labelForType(type: MemoryWithFile['type']): string {
  switch (type) {
    case 'image':
      return 'Photo';
    case 'document':
      return 'Document';
    case 'link':
      return 'Link';
    case 'note':
      return 'Note';
  }
}

function untitledForType(type: MemoryWithFile['type']): string {
  return type === 'link' ? 'Untitled link' : 'Untitled';
}

