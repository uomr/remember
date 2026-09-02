---
name: code-audit-security-hardening
description: >-
  Comprehensive code auditing, zero-defect type checking, OWASP security hardening,
  and headless verification protocols. Use when conducting security reviews, inspecting
  file upload safety, validating magic bytes, testing RLS isolation, or eliminating technical debt.
---

# Code Audit, Security Hardening & Zero-Defect Engineering

## 1. Strict TypeScript Discipline

- **Zero Tolerance for `any`:** Disallow `any` casts in production code. Use `unknown` with type guards or strict discriminated unions.
- **Strict Compiler Flags:**
  ```json
  {
    "compilerOptions": {
      "strict": true,
      "noImplicitAny": true,
      "strictNullChecks": true,
      "noUncheckedIndexedAccess": true
    }
  }
  ```
- **Typecheck Gate:** Every commit and phase transition must pass `tsc --noEmit` with **0 errors**.

---

## 2. File Upload & Binary Signature Verification

Never trust the `Content-Type` header sent by the client. Always inspect raw leading bytes (**Magic Bytes**):

```typescript
export function detectMagicBytes(buffer: Uint8Array): string | null {
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  // WebP: RIFF ... WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  // PDF: %PDF- (25 50 44 46 2D)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
  return null;
}
```

### Sanitization of File Names
- Strip directory traversal tokens (`..`, `/`, `\`).
- Remove control characters and non-printable bytes.
- Preserve Unicode characters safely when handling Arabic/multilingual file names without garbling.

---

## 3. Web & SSR Security (OWASP Hardening)

1. **Open Redirect Mitigation:**
   - On auth callback or redirect endpoints (`/auth/callback`), only allow relative paths (`/path`) and strictly reject protocol-relative URLs (`//evil.com`) or absolute foreign origins.
2. **XSS Prevention in User Links:**
   - Validate URLs strictly: Allow only `http:` and `https:` schemes.
   - Strip `javascript:`, `data:`, and `vbscript:` vectors.
3. **Secret Hygiene:**
   - `NEXT_PUBLIC_*` variables: Only public URL and anon key.
   - `SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY`: Server-side and diagnostic scripts only. Never expose to client bundles.

---

## 4. Headless Verification Testing Methodology

Before declaring any architectural phase complete, run an automated headless verification suite:
1. **Multi-User Isolation Proof:** Provision two ephemeral users (User A and User B).
2. **RLS Boundary Assertion:** Assert that User B receives 0 results when querying User A's memories, files, or signed URLs.
3. **Storage Access Proof:** Assert that raw bucket URLs fail (403/404) and only authenticated signed URLs succeed.
4. **Cleanup Guarantee:** Delete test data and verify zero orphaned database rows or storage objects remain.
