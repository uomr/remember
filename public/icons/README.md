# App icons

Placeholder folder. Add the following PNG icons here before shipping the PWA.
They are referenced by `public/manifest.webmanifest`.

| File                     | Size    | Purpose   | Notes                                                    |
| ------------------------ | ------- | --------- | -------------------------------------------------------- |
| `icon-192.png`           | 192×192 | `any`     | Home-screen icon (Android/desktop).                      |
| `icon-512.png`           | 512×512 | `any`     | High-res install icon, splash generation.                |
| `icon-maskable-512.png`  | 512×512 | `maskable` | Safe-zone padded so Android can mask into any shape.     |
| `apple-touch-icon.png`   | 180×180 | iOS       | Optional but recommended; referenced from `<head>`.      |
| `favicon.ico`            | 32×32   | browser   | Optional classic favicon.                                |

## Design guidance

- Match the calm palette: background `#faf9f7`, accent `#2f6d5f`.
- No purple gradients, no neon. Keep the mark simple and premium.
- For the maskable icon, keep the glyph inside the inner 80% safe zone.

TODO (Phase 1): produce the real icon set (a single 1024×1024 master exported to the sizes above).
