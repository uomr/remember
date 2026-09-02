---
name: hybrid-semantic-search-reranking
description: >-
  State-of-the-art methodology for building intelligent search engines combining
  lexical keyword retrieval, pgvector semantic embeddings, Reciprocal Rank Fusion (RRF),
  and LLM / Cross-Encoder rerankers. Use when implementing, tuning, or auditing search pipelines,
  embedding models, vector indexes, or multilingual intent understanding.
---

# Hybrid Search, Vector Retrieval & AI Reranking Masterclass

## 1. The Triad Architecture: Lexical + Semantic + Intent Judge

```
[User Query]
    ├── 1. Lexical Branch (FTS + Substring ILIKE) ──> Top N Candidates
    └── 2. Semantic Branch (Embed -> pgvector Cosine) ─> Top N Candidates (Floor: 0.1)
                                │
                        [ RRF Fusion (k=60) ]
                                │
                        [ Candidate Pruning (Top 20-30) ]
                                │
                    [ LLM / Cross-Encoder Judge ]
                                │
                    [ Filtered & Ranked Results ]
                                │
              (Fallback to Lexical on AI Failure)
```

---

## 2. Mathematical Fusion: Reciprocal Rank Fusion (RRF)

Combine ranked lists from heterogeneous algorithms without needing to calibrate raw score distributions (which have wildly different scales):

$$\text{RRF Score}(d) = \sum_{m \in \text{Methods}} \frac{1}{k + \text{Rank}_m(d)}$$

- Standard constant: $k = 60$.
- Items appearing in both lexical and semantic lists receive a substantial multiplicative boost, naturally bubbling up high-confidence results.

---

## 3. Vector Index Tuning (HNSW in pgvector)

- **Operator:** Cosine distance `<=>` (Similarity = $1 - \text{distance}$).
- **Parameters:**
  - `m = 16`: Number of bidirectional links per vector node. Good balance between recall and index size.
  - `ef_construction = 64`: Size of dynamic candidate list during index build.
  - `ef_search`: Set dynamically before search queries if higher recall is required (`SET hnsw.ef_search = 40;`).
- **Floor Strategy:** In hybrid pipelines, use a permissive retrieval floor (e.g. `similarity_threshold = 0.1` or `0.15`) to maximize recall, letting the subsequent RRF and AI judge filter out false positives.

---

## 4. Intent-Aware LLM Reranker Design

When embedding vectors fail on slang, subtle nuances, or domain synonyms (e.g., Arabic "جزمة" vs "حذاء" vs "شوز"), a lightweight LLM judge acts as the ultimate filter.

### Prompt Engineering Guidelines
1. **Strict Output Contract:** Demand JSON output exclusively containing an array of matched IDs.
2. **Contextual Pruning & Budgeting:**
   - Truncate candidate fields to prevent context blowout: Title <= 160 chars, Text <= 900 chars, URL <= 240 chars.
   - Limit candidate pool to top 20–30 items after RRF.
3. **Relevance Criteria:** Instruct the model to match the core concept/intent, understand dialects and spelling variations, and aggressively reject superficial token matches or unrelated notes.

```typescript
const prompt = `You are a search ranking engine. The user searched for: "${query}".
Evaluate the following candidates and return ONLY a JSON object with the IDs of items that genuinely match the intent.
Candidates:
${candidatesJson}
Output format: { "ids": ["id1", "id2"] }`;
```

---

## 5. Fail-Safe Resilience & Fallback

- Never let an AI timeout or provider outage bring down search.
- **Fail-Safe Cascade:**
  1. Primary: RRF + AI Reranker.
  2. If AI fails/times out: Fallback immediately to **Exact Lexical Matches**.
  3. Why? Exposing raw unverified semantic noise confuses users; returning exact keywords preserves trust.
