import Link from 'next/link';
import type { MemoryWithFile } from '@/lib/memories/queries';
import { formatFileSize, formatMemoryDate } from '@/lib/format';

/**
 * Editorial, calm Memory card.
 *
 * Identity comes from:
 *   WHAT IT IS + WHY IT MATTERS + WHEN/CONTEXT + supporting media.
 *
 * Exposes:
 *  - "Why did you show me this?" evidence badge during search
 *  - Responsive thumbnail delivery (?w=400) saving mobile data
 *  - Honest scanned PDF state ("Scanned document — text extraction unavailable")
 *  - Calm personal hierarchy over commercial product grids
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

  const thumbnailUrl = memory.fileUrl ? `${memory.fileUrl}?w=400` : null;

  return (
    <Link
      href={href}
      style={style}
      onClick={onClick}
      className={`group block overflow-hidden rounded-2xl border border-border bg-surface-raised p-5 shadow-soft transition-all duration-150 hover:border-border-strong hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {/* ── Top Meta: Type, Evidence Reason & Date ── */}
      <div className="flex items-center justify-between gap-2 mb-3 text-xs text-ink-faint">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {memory.type === 'document' ? documentBadge(memory) : memory.type}
          </span>

          {memory.evidenceReason ? (
            <span className="inline-flex items-center rounded-md bg-accent-soft/80 dark:bg-accent-soft-dark/80 px-2 py-0.5 text-[11px] font-medium text-accent truncate max-w-[190px]">
              {memory.evidenceReason}
            </span>
          ) : null}

          {memory.type === 'document' && memory.file?.file_size != null ? (
            <span className="text-[11px] text-ink-faint">
              {formatFileSize(memory.file.file_size)}
            </span>
          ) : null}
        </div>

        <span className="shrink-0 text-[11px]">{date}</span>
      </div>

      {/* ── 1. PHOTO CARD: Meaning first, supporting visual preview ── */}
      {memory.type === 'image' ? (
        <div className="space-y-2.5">
          <div>
            {memory.title && memory.title !== 'Untitled' ? (
              <p dir="auto" className="line-clamp-1 text-base font-medium text-ink leading-snug">
                {memory.title}
              </p>
            ) : null}
            {memory.text_content ? (
              <p dir="auto" className="line-clamp-2 text-xs text-ink-muted leading-relaxed mt-1">
                {memory.text_content}
              </p>
            ) : null}
          </div>

          {thumbnailUrl ? (
            <div className="h-36 w-full overflow-hidden rounded-xl border border-border/60 bg-surface-sunken relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt={memory.title ?? 'Saved photo'}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── 2. NOTE CARD: Pure typography and thought ── */}
      {memory.type === 'note' ? (
        <p
          dir="auto"
          className="line-clamp-4 whitespace-pre-line text-[15px] text-ink leading-relaxed"
        >
          {memory.text_content}
        </p>
      ) : null}

      {/* ── 3. LINK CARD: Subject & Personal Context ── */}
      {memory.type === 'link' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center rounded-md bg-accent-soft dark:bg-accent-soft-dark px-2 py-0.5 text-[11px] font-medium text-accent truncate">
              {cleanDomain || memory.url || 'Link'}
            </span>
          </div>

          <p dir="auto" className="line-clamp-2 text-base font-medium text-ink leading-snug">
            {memory.title ?? cleanDomain ?? 'Saved link'}
          </p>

          {memory.text_content ? (
            <p dir="auto" className="line-clamp-2 text-xs text-ink-muted leading-relaxed">
              {memory.text_content}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── 4. DOCUMENT CARD: Honest Extraction State & Text Snippet ── */}
      {memory.type === 'document' ? (
        <div className="space-y-2">
          <p dir="auto" className="line-clamp-1 text-base font-medium text-ink leading-snug">
            {memory.title ?? memory.file?.file_name ?? 'Document'}
          </p>

          {memory.extraction_status === 'pending' ? (
            <div className="flex items-center gap-1.5 text-xs text-accent pt-0.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              <span>Processing document…</span>
            </div>
          ) : memory.extraction_status === 'skipped' ? (
            <p className="text-xs text-ink-faint italic">
              Scanned document — text extraction unavailable
            </p>
          ) : memory.extraction_status === 'failed' ? (
            <p className="text-xs text-rose-500/80">
              Couldn&apos;t process document
            </p>
          ) : memory.text_content ? (
            <p dir="auto" className="line-clamp-2 text-xs text-ink-muted leading-relaxed">
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
