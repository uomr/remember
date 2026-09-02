/**
 * Magic-byte (file signature) sniffing.
 *
 * The declared MIME type on an upload is attacker-controlled — a renamed `.exe`
 * can claim `image/png`. Before anything touches Storage we read the real
 * leading bytes and reconcile them with what the client claimed. This is the
 * "stronger validation" the PRD (§29) asks for and closes the tech-debt note in
 * PROJECT_STATUS.md.
 *
 * Only the first bytes are read, so this is cheap even for large files.
 */

/** How many leading bytes we need to identify every signature we care about. */
const SNIFF_BYTES = 16;

/** A canonical family we can detect from bytes, mapped to the MIME(s) it backs. */
type SignatureFamily =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'heic'
  | 'pdf'
  | 'zip' // docx (Office Open XML is a zip container)
  | 'ole' // legacy .doc (OLE compound file)
  | 'unknown';

/** MIME types that are plain text and therefore have no reliable signature. */
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown']);

/** Which detected family satisfies a given declared MIME type. */
const MIME_TO_FAMILY: Record<string, SignatureFamily> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
  'application/msword': 'ole',
};

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

/** Detect the file family from its leading bytes. Returns 'unknown' if none match. */
export function detectFamily(bytes: Uint8Array): SignatureFamily {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // GIF: "GIF8"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  // WEBP: "RIFF" .... "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  // HEIC/HEIF: ".... ftyp" then a heic-family brand.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  // PDF: "%PDF-"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  // ZIP (docx and friends): "PK" 03 04 / 05 06 / 07 08
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return 'zip';
  }
  // OLE compound (legacy .doc): D0 CF 11 E0 A1 B1 1A E1
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';

  return 'unknown';
}

/** True if the leading bytes look like binary (contains a NUL in the sniff window). */
function looksBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0x00);
}

export interface SignatureCheck {
  ok: boolean;
  /** Human-language reason, when the signature contradicts the declared type. */
  reason?: string;
}

/**
 * Verify that a file's real leading bytes are consistent with its declared MIME
 * type. Reads only the first {@link SNIFF_BYTES} bytes.
 *
 * - Binary types (images, pdf, docx, doc): the sniffed family MUST match.
 * - Text types (text/plain, text/markdown): no signature exists, so we only
 *   reject content that is clearly a binary file wearing a text label.
 * - Unknown declared types are left to the caller's allow-list (this function
 *   only judges declared-vs-actual consistency).
 */
export async function verifySignature(file: File, declaredType: string): Promise<SignatureCheck> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());

  if (TEXT_MIME_TYPES.has(declaredType)) {
    // A text file should not carry a known binary signature or NUL bytes.
    if (detectFamily(head) !== 'unknown' || looksBinary(head)) {
      return { ok: false, reason: "That file's contents don't match a text file." };
    }
    return { ok: true };
  }

  const expected = MIME_TO_FAMILY[declaredType];
  if (!expected) {
    // Declared type isn't one we signature-check; defer to the allow-list.
    return { ok: true };
  }

  const actual = detectFamily(head);
  if (actual !== expected) {
    return { ok: false, reason: "That file's contents don't match its type." };
  }

  return { ok: true };
}
