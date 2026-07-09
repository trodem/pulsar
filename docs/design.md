# Pulsar — Design & Style Guide

Guidance for AI agents (and humans) working on Pulsar's UI. **Read this before
touching any styling.**

## Core principle: one source of truth

Pulsar has a **centralized** style system. All visual decisions — colors,
radii, and the reusable component look — live in **one file**:

> **`client/src/style.css`**

Everything else (Vue components) must *consume* that file through **design
tokens** (CSS custom properties) and **shared class names**. The goal is simple:

> To restyle the whole app, you change `style.css` in one place, and every
> screen updates. A component should never hardcode a color, and should rarely
> hardcode a size.

If you find yourself writing a raw hex color or a bespoke look inside a `.vue`
file, stop — it belongs in `style.css` as a token or a class.

---

## Design tokens (the knobs)

Defined once in the `:root` block at the top of `client/src/style.css`. These
are the **only** place raw color/radius values should appear. Change a value
here and it propagates everywhere.

### Surfaces & structure
| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0d1117` | App background (deepest layer) |
| `--bg-elev` | `#161b22` | Elevated surface: header, sidebar, cards |
| `--bg-elev-2` | `#1c2330` | Higher elevation: default buttons, hover/active rows |
| `--border` | `#2a2f3a` | All hairline borders / dividers |
| `--radius` | `10px` | Corner radius (see “gaps” — not yet applied everywhere) |

### Text
| Token | Value | Use |
| --- | --- | --- |
| `--text` | `#e6edf3` | Primary text |
| `--text-dim` | `#8b95a5` | Secondary/muted text, labels, inactive nav |

### Brand / accent
| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#38bdf8` | **The app color.** Brand dot, sidebar icons, primary button, focus rings, links-in-context |
| `--on-accent` | `#ffffff` | Text/icon on any filled accent or status surface (primary button, badges) |

> "The app's primary color" = `--accent`. To rebrand Pulsar, change this one
> line and the logo dot, sidebar icons, primary button, and focus states all
> move together.

### Soft tints & scrim (derived)
Translucent versions of the palette, defined with `color-mix()` so they **follow
the base color automatically** — change `--up` and `--up-soft` updates too.

| Token | Derived from | Use |
| --- | --- | --- |
| `--up-soft` / `--down-soft` / `--degraded-soft` / `--pending-soft` / `--maintenance-soft` | matching status color @ 16% | Status pill backgrounds, LED glow rings |
| `--accent-soft` | `--accent` @ 16% | Chip backgrounds (e.g. user chips) |
| `--accent-border` | `--accent` @ 40% | Accent chip/tile borders |
| `--down-border` | `--down` @ 30% | Error message border |
| `--scrim` | `rgba(0,0,0,0.6)` | Modal backdrop overlay |

### Radius
| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | `5px` | Small badges (type tag, tag badge) |
| `--radius-sm` | `8px` | Buttons, inputs, nav links, icon buttons |
| `--radius` | `10px` | Cards, modals, dropdown menus |
| `--radius-pill` | `999px` | Pills & chips (status pill, tag chip, count badge) |

### Typography
| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `--font-family` | Segoe UI stack | | `--fs-base` | `14px` |
| `--font-mono` | mono stack | | `--fs-lg` | `16px` |
| `--fs-2xs` | `10px` | | `--fs-xl` | `18px` |
| `--fs-xs` | `11px` | | `--fs-2xl` | `20px` |
| `--fs-sm` | `12px` | | `--fs-3xl` | `22px` |
| `--fs-md` | `13px` | | | |

### Spacing scale
`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` ·
`--space-5: 20px` · `--space-6: 24px` · `--space-7: 32px`. Use these for new
`gap` / `padding` / `margin`.

### Elevation / shadow
`--shadow-sm` (control thumbs) · `--shadow-md` (lifted heartbeat) ·
`--shadow-pop` (dropdown menus) · `--shadow-pop-strong` (tooltips).

### Layout dimensions
`--sidebar-w: 230px` · `--sidebar-w-collapsed: 66px` · `--header-h: 56px`.

### Status colors
These map 1:1 to monitor heartbeat status codes. Never invent a status color —
use the token.

| Status code | Meaning | Token | Value |
| --- | --- | --- | --- |
| `1` | Up | `--up` | `#22c55e` |
| `2` | Degraded | `--degraded` | `#f97316` |
| `3` | Maintenance | `--maintenance` | `#3b82f6` |
| `0` | Down | `--down` | `#ef4444` |
| `null`/other | Pending | `--pending` | `#f59e0b` |

The mapping from status code → label + CSS class lives in
`client/src/format.ts` (`statusLabel()`), which returns classes
`status-up` / `status-degraded` / `status-maintenance` / `status-down` /
`status-pending`. Use `statusLabel()` for status text/badges rather than
re-deriving it in a component.

### Theme
The app is **dark-only** today (`color-scheme: dark` on `:root`). There is no
light theme; do not add `prefers-color-scheme` overrides without a decision to
support both.

---

## Class vocabulary (the reusable pieces)

Prefer these existing classes over new styles. All are defined in `style.css`.

### Buttons
- `.btn` — base button (elevated surface, bordered).
- `.btn-primary` — filled with `--accent`, white text. The one call-to-action per view (e.g. "+ New monitor").
- `.btn-danger` — destructive (outlined in `--down`).
- `.btn-sm` — smaller padding/size. Compose with the above.
- `.btn-icon` — square, icon-only (emoji centered). Used in dense action rows.

Compose, don't fork: e.g. `class="btn btn-primary btn-sm"`.

### Layout & shell
- `.app-shell`, `.app-header`, `.app-body`, `.sidebar`, `.main` — the frame (`App.vue`).
- `.nav-link`, `.nav-icon`, `.nav-label` — sidebar entries. Icons are SVGs with `stroke="currentColor"`; `.nav-icon` tints them with `--accent`.
- `.page-head`, `.page-actions` — the title + toolbar row every page starts with.

### Cards & data
- `.stat-card`, `.stat-cards` — metric cards (detail view, dashboards).
- `.monitor-card`, `.monitor-card-header`, `.monitor-card-body`, `.monitor-actions` — monitor list cards and their action toolbox.
- `.monitor-actions` is the shared **action toolbox** (Open / Online users / Pause / Edit / Delete …). It is used in both the monitors list and the monitor-detail header — keep them in sync.

### Badges, pills, chips
- `.status-pill` + a `status-*` class — status label pill.
- `.led` — small status dot; `.led-paused` for paused monitors.
- `.type-tag`, `.tag-badge`, `.paused-badge`, `.user-chip` — inline labels.

### Forms & controls
- `.field`, `.field label`, `.field input`, `.field select`, `.field-row` — form layout (`MonitorForm.vue`).
- `.search-box`, `.search-input`, `.search-clear` — the toolbar search.
- `.status-select` — the single-select status filter dropdown.
- `.modal-backdrop`, `.modal`, `.modal-actions` — dialogs.

When a new UI needs a control that already exists here, reuse the class. Only
add a new class when the pattern is genuinely new — and add it to `style.css`,
not inline.

---

## Rules for agents

**Do**
1. Read a color/spacing from a **token** (`var(--…)`) — never a literal.
2. Reuse an existing **class** before writing new CSS.
3. Put any new shared style in **`client/src/style.css`**, named semantically.
4. Add a new **token** to `:root` when you need a new color/value that could
   ever be reused or themed — then reference it.
5. Use `statusLabel()` (`format.ts`) for anything status-colored.

**Don't**
1. ❌ Hardcode hex colors in `.vue` files (e.g. `color: #fff`, `background: #38bdf8`).
2. ❌ Add non-trivial `style="…"` blocks in templates. A one-off `margin` is
   tolerable; a color, a layout system, or anything repeated is not.
3. ❌ Duplicate a component look by copy-pasting CSS into a component.
4. ❌ Introduce a second place that defines the theme.

**Litmus test:** *"If the user wanted to change this across the whole app,
could they do it in `style.css` alone?"* If not, refactor until they can.

---

## How to make a global change (examples)

- **Rebrand color:** edit `--accent` in `:root`. Updates brand dot, sidebar
  icons, primary button, focus rings.
- **Darker/warmer background:** edit `--bg` / `--bg-elev` / `--bg-elev-2`.
- **Softer corners everywhere:** edit `--radius` (after closing the gap below).
- **Change what "Degraded" looks like:** edit `--degraded`.

---

## State of centralization

**Done (fully tokenized in `style.css`):**
- Colors — including `--on-accent` and the derived `*-soft` / border / scrim
  tints, so a palette change propagates everywhere (no stray hex or `rgba()`).
- Radius — all corners route through `--radius-xs/-sm/-/pill`.
- Typography — every `font-size` uses an `--fs-*` token; font families are
  tokenized.
- Shadows — all box-shadows use `--shadow-*`.
- Layout dimensions — sidebar/header sizes are tokens.

**Remaining nuances (close opportunistically):**
1. **Spacing is a scale, not yet fully retrofitted.** The `--space-*` tokens
   exist and should be used for *new* `gap`/`padding`/`margin`. Legacy CSS still
   has literal px for spacing (many are off-grid values like `6px`/`18px`/`26px`
   that don't map cleanly to the scale). Migrate a value only when you're also
   happy to snap it to the nearest scale step — don't blindly alias.
2. **`Maintenance.vue` has a scoped `<style>` block.** Its colors are tokenized,
   but its font-sizes/spacing/radius still use literals. It's the only component
   with local CSS; prefer moving genuinely shared pieces into `style.css`.
3. **A few inline `:style` bindings** in views set colors via `var(--…)` tokens
   (fine) or drive dynamic per-tag colors from data (`t.color`, unavoidable).
   Static one-off layout `style="…"` is tolerated; new *shared* looks belong in
   `style.css`.

The color / radius / type / shadow theming knobs are now genuinely
"change-in-one-place." Spacing is the only axis where a global change still
touches multiple declarations.
