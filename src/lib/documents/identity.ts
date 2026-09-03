import { createHash } from 'node:crypto';

/**
 * Current version of the document extraction and chunking pipeline.
 * Incrementing this version invalidates cached extractions and allows
 * deterministic re-processing when the parser logic improves.
 */
export const PARSER_VERSION = 'v1';

/**
 * Compute the cryptographic SHA-256 hash of a Buffer or string.
 * Used for file identity, content identity, and per-chunk identity.
 */
export function computeSha256(data: Buffer | string): string {
  const hash = createHash('sha256');
  if (typeof data === 'string') {
    hash.update(data, 'utf8');
  } else {
    hash.update(data);
  }
  return hash.digest('hex');
}

/**
 * Check whether an existing extraction is still valid for a given file and parser.
 * If file_hash and parser_version match, extraction can be reused completely ($0 CPU / $0 AI).
 */
export function isExtractionFresh(
  currentFileHash: string,
  storedFileHash?: string | null,
  storedParserVersion?: string | null,
): boolean {
  if (!storedFileHash || !storedParserVersion) return false;
  return currentFileHash === storedFileHash && storedParserVersion === PARSER_VERSION;
}

/**
 * Check whether chunks already in the database match the current content.
 * If content_hash matches, chunks do NOT need to be re-created or re-indexed.
 */
export function areChunksFresh(
  currentContentHash: string,
  storedContentHash?: string | null,
  chunkCount?: number | null,
): boolean {
  if (!storedContentHash || !chunkCount || chunkCount <= 0) return false;
  return currentContentHash === storedContentHash;
}
