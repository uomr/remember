---
name: nextjs-app-router-architect
description: >-
  Advanced engineering guide for Next.js 14 App Router, Server Actions, Server Components,
  PWA caching, middleware authentication, and strict TypeScript patterns. Use when developing
  routes, server actions, client components, optimizing rendering performance, or managing PWA lifecycle.
---

# Next.js 14 App Router & Full-Stack Architecture Guide

## 1. Component Boundaries: Server vs Client

### Rule 1: Server Components by Default
- Keep data fetching, database queries, and environment secret access inside Server Components (`src/app/**/page.tsx`, `layout.tsx`).
- Benefits: Zero client bundle footprint, direct database access, secure secret handling.

### Rule 2: Client Components Only for Leaf Interactivity
- Mark with `'use client'` only at the lowest possible leaf component requiring browser APIs (hooks like `useState`, `useRef`, `useRouter`, or DOM events).
- Do not make entire pages client components when only a modal or button needs state.

```tsx
// Correct Pattern: Server Page hosting interactive Leaf Components
export default async function Page({ searchParams }: { searchParams: { q?: string } }) {
  const memories = await listMemories({ query: searchParams.q });
  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <SearchBar initialQuery={searchParams.q} />
      <CaptureButton />
      <MemoryList memories={memories} />
    </main>
  );
}
```

---

## 2. Server Actions Best Practices

1. **Colocation & Modularity:** Group actions in `src/app/actions/<domain>.ts` with explicit `'use server'`.
2. **Strict Authorization & Session Verification:** Never trust client-sent `userId`. Always read the session inside the action using `supabase.auth.getUser()`.
3. **Robust Input Validation:** Validate FormData, file sizes, MIME types, and string constraints before touching storage or database layers.
4. **Revalidation & State Transitions:** Use `revalidatePath('/')` to refresh cached server data after mutations.

```typescript
'use server';

import { createServerClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createMemoryAction(formData: FormData) {
  const supabase = createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: 'Unauthorized' };
  }

  // Input validation & mutation logic...
  revalidatePath('/');
  return { ok: true };
}
```

---

## 3. Middleware & Session Synchronization

- **`@supabase/ssr` Token Refresh:** Middleware must invoke `updateSession` to refresh expired auth cookies on incoming requests.
- **Route Matcher Optimization:** Exclude static files, fonts, manifest, and service workers from middleware invocation to avoid unnecessary latency.

```typescript
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|offline).*)',
  ],
};
```

---

## 4. Progressive Web App (PWA) Integration

1. **Manifest Configuration:** Standalone display mode, proper icon sizes (`192x192`, `512x512`, `maskable`), and `share_target` registration.
2. **Service Worker Lifecycle:**
   - Pre-cache `/offline` fallback and core branding assets.
   - Network-first navigation strategy for authenticated pages.
   - Stale-While-Revalidate for static assets.
   - **Crucial:** Never cache authenticated HTML or private user media in the generic service worker cache.
3. **Web Share Target:** Handle multipart file and text sharing via dedicated API/action routes (e.g. `/share`).
