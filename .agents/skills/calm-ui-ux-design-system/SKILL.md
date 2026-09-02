---
name: calm-ui-ux-design-system
description: >-
  Expert instructions for designing and implementing Calm Technology, minimalist,
  and high-engagement mobile-first web applications using Tailwind CSS and Next.js.
  Use whenever building or refining UI components, styling layouts, handling responsive
  ergonomics, creating empty/loading states, or tuning typography and color harmony.
---

# Calm Technology & Minimalist UI/UX Design System

## Core Philosophy
1. **Attention as a Finite Resource:** The interface must recede into the background until actively needed. Never scream "Look at me!" or overwhelm with excessive badges, banners, neon gradients, or card-in-card nesting.
2. **Zero-Organization Burden:** The user captures and retrieves. The UI assists invisibly without forcing category selection, folder creation, or tedious tagging.
3. **Warmth, Trust, and Stability:** Use soft, natural palettes, generous negative space, crisp typography, and subtle micro-interactions that feel reassuring and alive.

---

## 1. Design Tokens & Color Palette

### Base Theme
- **Background (`surface-ground`):** Warm off-white `#faf9f7` (light) or deep slate `#121316` (dark).
- **Surface (`surface-card`):** Pure white `#ffffff` or elevated charcoal `#1a1c20`.
- **Primary Accent (`accent`):** Deep calming teal-green `#2f6d5f` (hover: `#245449`, active: `#1b3f37`, soft: `#eaf3f0`).
- **Typography (`ink`):**
  - Primary text (`ink-primary`): Soft near-black `#1c1e21` / `#f0f2f5`.
  - Secondary text (`ink-muted`): Warm slate `#5f656d` / `#9ca3af`.
  - Subtle captions (`ink-subtle`): `#8c929c` / `#6b7280`.
- **Borders & Dividers (`border`):** Low-contrast warm beige/gray `#e7e5e0` / `#2a2d33`.
- **Destructive/Danger (`danger`):** Muted terracotta red `#c24b38` (avoid aggressive neon reds).

### Sizing & Radius
- **Border Radius:**
  - Cards & Modals: `rounded-2xl` (`1rem` - `1.25rem`).
  - Inputs & Buttons: `rounded-xl` (`0.75rem`).
  - Badges & Chips: `rounded-full`.
- **Elevation / Shadows:**
  - Standard Card: `shadow-sm` (`0 1px 2px 0 rgb(0 0 0 / 0.04)`).
  - Modal / Bottom Sheet: `shadow-xl` (`0 20px 25px -5px rgb(0 0 0 / 0.1)`).

---

## 2. Mobile-First Ergonomics & Layout

1. **Thumb Zone Rule:**
   - Primary interactive triggers (Capture Button, Bottom Navigation, Search Activation) must be placed in the bottom 40% of the viewport on mobile devices.
   - Touch targets must be at least **48x48px** with adequate padding (`p-3` or `py-3 px-4`).
2. **Responsive Breakpoints:**
   - Mobile (`<640px`): Single column grid, bottom sheets for capture/actions, sticky header/search.
   - Tablet & Desktop (`>=640px`): 2 or 3 column auto-fitting grid, centered floating modals with backdrop blur (`backdrop-blur-sm bg-black/40`).
3. **No Layout Shifts (CLS):**
   - Explicit aspect ratios for media cards (`aspect-video` or `aspect-[4/3]`) with subtle skeleton placeholders before images load.

---

## 3. Micro-Interactions & Motion Guidelines

- **Duration:** Keep transitions fast and crisp: `150ms` to `200ms`.
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) for natural responsiveness.
- **Interactive Feedback:**
  - Buttons: `active:scale-[0.98] transition-transform duration-150`.
  - Cards: `hover:border-accent/40 transition-colors duration-200`.
  - Focus Ring: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`.
- **Accessibility:** Respect `prefers-reduced-motion: reduce` by disabling non-essential transforms.

---

## 4. Typography & Bilingual / RTL Support

1. **Font Stack:**
   ```css
   font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
   ```
2. **RTL & Arabic Optimization:**
   - Ensure proper bidirectional rendering (`dir="auto"` or `dir="rtl"`).
   - Maintain comfortable line-height (`leading-relaxed` or `leading-loose`) for Arabic glyphs to prevent clipping.
   - Pair English and Arabic captions cleanly without visual imbalance.

---

## 5. Screen States & UX Patterns

- **Empty States:** Never show a barren or depressing blank screen. Use inspiring, warm copy with an immediate direct action (e.g., *"Your memory is clean and ready. Save something you might need later."* + `+ Remember something`).
- **Loading & Skeleton States:** Use subtle pulsing skeletons with matching dimensions rather than aggressive spinning wheels.
- **Error Boundaries:** Human-first language only. Never expose raw 500s or technical stack traces. Explain what happened, assure data safety, and provide a single clear retry button.
