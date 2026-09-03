/**
 * AI abstraction layer — types.
 *
 * The rest of the app depends ONLY on this interface, never on a concrete
 * provider or vendor SDK. This keeps AI optional, swappable, and cost-controlled
 * (see docs/DECISIONS.md ADR-003). AI is disabled by default in the MVP.
 */

/** A vector embedding (list of floats). */
export type Embedding = number[];

/** Result of an OCR pass over an image. */
export interface OcrResult {
  text: string;
}

/** Result of describing an image. */
export interface ImageDescription {
  description: string;
}

/** Combined OCR + description in a single image fetch (avoids fetching twice). */
export interface ImageAnalysis {
  description: string;
  ocrText: string;
}

/** Result of extracting text from a document. */
export interface ExtractedText {
  text: string;
}

/** Minimal searchable representation sent to the optional AI reranker. */
export interface SearchCandidate {
  id: string;
  type: string;
  title: string;
  text: string;
  url: string;
}

/** AI-selected relevant ids, ordered from best to worst. */
export interface SearchRanking {
  ids: string[];
}

/**
 * The single interface every AI provider implements. Features call these
 * methods via getAIService(); they must tolerate a disabled provider.
 */
export interface AIService {
  /** Whether this provider actually does anything. */
  readonly enabled: boolean;

  /** Extract text from an image (OCR). */
  ocr(input: { fileUrl: string }): Promise<OcrResult>;

  /** Produce a short natural-language description of an image. */
  describeImage(input: { fileUrl: string }): Promise<ImageDescription>;

  /**
   * OCR + describe in one call (fetches the image ONCE, runs both prompts).
   * Prefer this over calling ocr() + describeImage() separately when both are needed.
   */
  ocrAndDescribeImage(input: { fileUrl: string }): Promise<ImageAnalysis>;

  /** Extract text content from a document (PDF, docx, etc.). */
  extractText(input: { fileUrl: string }): Promise<ExtractedText>;

  /** Produce a vector embedding for a piece of text. */
  embed(input: { text: string }): Promise<Embedding>;

  /** Select only truly relevant candidates and order them by intent match. */
  rankSearch(input: {
    query: string;
    candidates: SearchCandidate[];
  }): Promise<SearchRanking>;
}
