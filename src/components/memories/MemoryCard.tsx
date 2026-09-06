import Link from 'next/link';
import type { MemoryWithFile } from '@/lib/memories/queries';
import { formatFileSize, formatMemoryDate } from '@/lib/format';

/**
 * Purpose-built, calm memory card.
 *
 * Honors the authentic nature of each medium:
 * - Image: The visual is the hero, with a natural aspect ratio and subtle caption.
 * - Note: Editorial, spacious typography on a clean paper surface.
 * - Link: Title and personal reason for saving are prominent; URL is reduced to a clean domain badge.
 * - Document: Real filename, file-type badge, size, and extracted text preview.
 */
export function MemoryCard({
  memory,
  className = '',
  style,
  searchContext,
  onClick,
}: {
  memory: MemoryWithFile;
  className?: string;
  style?: React.CSSProperties;
  searchContext?: {
    query: string;
    position: number;
    sessionId?: string;
  };
  onClick?: () => void;
}) {
  const date = formatMemoryDate(memory.created_at);

  const cleanDomain = memory.url
    ? memory.url
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0]
    : '';

  const href = searchContext?.query
    ? `/memory/${memory.id}?fromQuery=${encodeURIComponent(searchContext.query)}&pos=${searchContext.position}&session=${encodeURIComponent(searchContext.sessionId || '')}`
    : `/memory/${memory.id}`;

  return (
    <Link
      href={href}
      style={style}
      onClick={onClick}
      className={`group block overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-soft transition-all duration-150 hover:border-border-strong hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {/* ------------------------------------------------------------- */}
      {/* 1. PHOTO CARD: The Image is the Hero                           */}
      {/* ------------------------------------------------------------- */}
      {memory.type === 'image' ? (
        <div>
          {memory.fileUrl ? (
            <div className="aspect-[16/10] w-full bg-surface-sunken overflow-hidden relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={memory.fileUrl}
                alt={memory.title ?? 'Saved photo'}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              />
              <div className="absolute top-3 right-3 rounded-full bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-medium text-white/90">
                {date}
              </div>
            </div>
          ) : null}
          <div className="p-4 space-y-1">
            {memory.title && memory.title !== 'Untitled' ? (
              <p dir="auto" className="line-clamp-1 text-sm font-medium text-ink">
                {memory.title}
              </p>
            ) : null}
            {memory.text_content ? (
              <p dir="auto" className="line-clamp-2 text-sm text-ink-muted leading-relaxed">
                {memory.text_content}
              </p>
            ) : null}
            {!memory.fileUrl ? (
              <div className="flex items-center justify-between text-xs text-ink-faint pt-1">
                <span className="text-accent font-medium text-[11px]">Photo</span>
                <span>{date}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- */}
      {/* 2. NOTE CARD: The Written Thought is the Hero                  */}
      {/* ------------------------------------------------------------- */}
      {memory.type === 'note' ? (
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-ink-faint">
            <span className="text-accent font-medium text-[11px] tracking-wide uppercase">
              Note
            </span>
            <span>{date}</span>
          </div>
          <p
            dir="auto"
            className="line-clamp-4 whitespace-pre-line text-[15px] text-ink leading-relaxed"
          >
            {memory.text_content}
          </p>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- */}
      {/* 3. LINK CARD: Subject & Personal Context over long URLs        */}
      {/* ------------------------------------------------------------- */}
      {memory.type === 'link' ? (
        <div className="p-5 space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs text-ink-faint">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-accent-soft dark:bg-accent-soft-dark px-2 py-0.5 text-[11px] font-medium text-accent">
                {cleanDomain || 'Link'}
              </span>
            </div>
            <span>{date}</span>
          </div>

          <p dir="auto" className="line-clamp-2 text-base font-medium text-ink leading-snug">
            {memory.title ?? cleanDomain ?? 'Saved link'}
          </p>

          {memory.text_content ? (
            <p dir="auto" className="line-clamp-2 text-sm text-ink-muted leading-relaxed">
              {memory.text_content}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------------- */}
      {/* 4. DOCUMENT CARD: Filename, Extension Badge, Size & Preview   */}
      {/* ------------------------------------------------------------- */}
      {memory.type === 'document' ? (
        <div className="p-5 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-ink-faint">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold uppercase text-ink-muted">
                {documentBadge(memory)}
              </span>
              {memory.file?.file_size != null ? (
                <span className="text-[11px] text-ink-faint">
                  {formatFileSize(memory.file.file_size)}
                </span>
              ) : null}
            </div>
            <span>{date}</span>
          </div>

          <p dir="auto" className="line-clamp-1 text-base font-medium text-ink leading-snug">
            {memory.title ?? memory.file?.file_name ?? 'Document'}
          </p>

          {/* Document extraction lifecycle status */}
          {memory.extraction_status === 'pending' ? (
            <div className="flex items-center gap-1.5 text-xs text-accent pt-0.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              <span>Processing document…</span>
            </div>
          ) : memory.extraction_status === 'skipped' ? (
            <p className="text-xs text-ink-faint italic">
              Scanned document (No text layer)
            </p>
          ) : memory.extraction_status === 'failed' ? (
            <p className="text-xs text-rose-500/80">
              Couldn&apos;t process document
            </p>
          ) : memory.text_content ? (
            /* Extracted text snippet preview */
            <p dir="auto" className="line-clamp-2 text-sm text-ink-muted leading-relaxed">
              {memory.text_content}
            </p>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}

function documentBadge(memory: MemoryWithFile): string {
  const name = (memory.file?.file_name || memory.title || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'PDF';
  if (name.endsWith('.docx') || name.endsWith('.doc')) return 'DOC';
  if (name.endsWith('.txt')) return 'TXT';
  if (name.endsWith('.md')) return 'MD';
  return 'DOC';
}
