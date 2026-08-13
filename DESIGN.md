# Design system

Pages were built across ten phases, and each styled its own buttons, cards and
tables. This document is the system they were unified onto. **Build new pages
from these primitives** — a page that hand-rolls its own button is how the drift
started the first time.

Everything lives in two files:

- [globals.css](src/app/globals.css) — tokens
- [ui.tsx](src/app/_components/ui.tsx) — components

---

## Colour

Colours are **semantic roles, never palette steps**. Components say
`bg-surface`, not `bg-white dark:bg-zinc-900`. This is the single most important
rule here: it is what stops light and dark themes drifting apart one component
at a time, and it means a theme change is one file rather than a search.

| Token | Role |
|---|---|
| `canvas` | Page background |
| `surface` | Cards, panels, the header |
| `sunken` | Inset areas — table headers, chips, meter tracks |
| `hovered` | Row and control hover |
| `content` | Primary text |
| `muted` | Secondary text, labels |
| `subtle` | Tertiary — placeholders, em-dashes, timestamps |
| `line` / `line-strong` | Borders; `strong` for inputs and secondary buttons |
| `primary` | The single accent |
| `success` `warning` `danger` `info` | Status, each with `-subtle` and `-text` pairs |

**One accent.** `primary` marks the action to take and the active nav item —
nothing decorative. When everything is coloured, nothing reads as important.

**Status colour applies to data, not chrome.** Green on a utilisation figure
means "healthy"; it is never applied because green looks nice.

## Typography

Geist, loaded in the root layout. (The previous stylesheet overrode it with
Arial, so the font the app went to the trouble of loading never actually
rendered.)

| Use | Class |
|---|---|
| Page title | `text-2xl sm:text-3xl font-semibold tracking-tight` |
| Card title | `text-base font-semibold` |
| Headline number | `text-2xl` / `text-3xl` when emphasised |
| Body / table cell | `text-sm` |
| Label / caption | `text-xs uppercase tracking-wide text-muted` |

Hierarchy is **weight and colour first, size second**. Four sizes is enough; a
fifth usually means the layout needs rethinking rather than another step.

**Numbers use `.tabular`.** Figures must align column to column, or scanning a
workload table means re-reading every row.

## Spacing

A single rhythm: `gap-4` between cards in a grid, `space-y-6` between page
sections, `px-5 py-4` inside card headers, `px-4 py-3` in table cells. Deviating
per page is exactly the drift this system removes.

## Components

| Component | Use |
|---|---|
| `PageHeader` | Every page. Title, optional description, actions, breadcrumb |
| `Card` / `CardHeader` / `CardBody` | Every panel |
| `Button` / `ButtonLink` | `primary` \| `secondary` \| `ghost` \| `danger` |
| `Field` + `inputClass` | Every form control — label, hint, consistent focus ring |
| `Table` family | `TableWrap` → `Table` → `THead`/`TBody`/`TR`/`TD` |
| `Badge` / `Dot` | Status. `Dot` for long lists where a badge per row is noise |
| `StatTile` | Headline numbers |
| `Meter` | A percentage as a bar plus its value |
| `EmptyState` / `ErrorState` / `Alert` | The non-happy paths |
| `Skeleton` and friends | Loading |

### Two behaviours worth knowing

**`StatTile` renders `null` as "Not measurable", never as 0.** The distinction
between "we measured zero" and "there was nothing to measure" is load-bearing
throughout this product, and it has to survive all the way to the screen.

**Utilisation and compliance carry a tone**, from `utilizationTone()` and
`complianceTone()` in `ui.tsx`. The bands are defined once, there, rather than
re-derived per screen:

- Utilisation: `>100%` danger (over capacity) · `≥75%` success · `≥60%` warning · below that danger
- Compliance: `≥90%` success · `≥50%` warning · below that danger

## Loading and empty states

**Skeletons mirror the shape they replace** (`StatGridSkeleton`,
`TableSkeleton`), so the page does not jump when data lands. A centred spinner
would be less work and worse.

**Every list that can legitimately be empty has an `EmptyState`** naming what is
missing and, where there is one, the action that fills it. A freshly created
university should read as "ready to set up", not as broken.

## Responsive

Breakpoints live in the primitives, so pages inherit them. Stat grids are
`grid-cols-2 lg:grid-cols-4`; the nav sits inline on desktop and wraps below the
bar on mobile; secondary header text hides under `sm`.

**Wide tables scroll inside `TableWrap`, never the page body.** All nine tables
are wrapped — a page that scrolls horizontally on a phone is the fastest way to
make a product feel unfinished.

## Deliberately avoided

Gradients, heavy shadows, decorative animation, and more than one accent colour.
Depth comes from borders and background steps. The reference points are Linear
and Stripe's dashboard: confident, restrained, data-forward.
