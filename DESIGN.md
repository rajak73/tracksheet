# Design system

The product-facing brand is **NIAT** — University Workforce Intelligence.
The repository, npm package name, session cookie, and database/container
names are unchanged: those are infrastructure identifiers, not UI, and this
has been a presentation-layer pass throughout.

Pages were built across fourteen phases. This document is the system they
were unified onto — a Phase 11 pass fixed token/component drift and built out
every missing page (eleven backend endpoints had no UI at all, and navigation
exposed only 4–5 of each role's 7–9 destinations); Phase 14 settled the visual
identity on a client-specified **Dark Navy + Royal Blue + Cool White** system,
with a fixed navy sidebar carrying the brand and a profile control in its
footer. **Build new pages from these primitives** — a page that hand-rolls its
own button is how the drift started the first time.

Everything lives in a small set of files:

- [globals.css](src/app/globals.css) — tokens
- [ui.tsx](src/app/_components/ui.tsx) — static primitives (server-safe)
- [interactive.tsx](src/app/_components/interactive.tsx) — Dialog, Toast, Tabs, PeriodSelector, InsightCard (client-only)
- [charts.tsx](src/app/_components/charts.tsx) — TrendLine, BarCompare, AllocationBar, Sparkline
- [icons.tsx](src/app/_components/icons.tsx) — the icon set
- [AppShell.tsx](src/app/_components/AppShell.tsx) / [nav.tsx](src/app/_components/nav.tsx) — the shell and role navigation
- [_lib/format.ts](src/app/_lib/format.ts) — every date/hours/percentage rendering rule, once
- [_lib/api.ts](src/app/_lib/api.ts) — `useLoad`, `apiGet`/`apiSend`, the shared `/api/auth/me` cache

---

## Colour

Colours are **semantic roles, never palette steps**. Components say
`bg-surface`, not `bg-white dark:bg-zinc-900`. This is the single most important
rule here: it is what stops light and dark themes drifting apart one component
at a time, and it means a theme change is one file rather than a search.

The palette is **Dark Navy + Royal Blue + Cool White**. Navy (`#162238`) is
the *structural* brand anchor and belongs almost exclusively to the sidebar
and mobile navigation — it is not a workspace colour. Royal Blue (`#1467E8`)
is the *interaction* colour: primary buttons, links, active indicators,
selected controls, the primary chart series. The workspace is a very light
cool grey-blue (`#F7F9FC`), never stark white everywhere, which produces the
intended layering:

```
NAVY SIDEBAR  →  LIGHT WORKSPACE  →  WHITE CARDS
```

Roughly **70–80% neutral, 10–15% navy, 5–10% blue**, with semantic colour
used sparingly on top. That ratio is enforced by convention, not code: a page
that reaches for navy or blue on every card has drifted.

| Token | Role |
|---|---|
| `canvas` | Page background — cool grey-blue, `#F7F9FC` |
| `surface` | Cards, panels, dialogs, the header — `#FFFFFF` |
| `sunken` | Inset areas — table headers, chips, meter tracks |
| `hovered` | Row and control hover |
| `content` | Primary text — `#162238`, the same navy family as the header |
| `muted` | Secondary text, labels — `#526074` |
| `subtle` | Tertiary — placeholders, em-dashes, timestamps — `#64748B` |
| `line` / `line-strong` | Borders — `#D9E2EF` |
| `primary` | Interaction colour — Royal Blue, `#1467E8` (hover/text `#0F52C4`, soft `#EFF6FF`) |
| `brand-navy` | Structural brand navy — `#162238` (same value as `sidebar-bg`) |
| `success` `warning` `danger` `info` | Status, each with `-subtle` and `-text` pairs |
| `sidebar-bg` `sidebar-text` `sidebar-text-muted` `sidebar-border` `sidebar-hover-bg` `sidebar-active-bg` `sidebar-active-accent` | The sidebar's own token set — see below |

This table was re-tuned against a client-supplied reference screenshot. Two
adjustments there are worth recording, since a future reader diffing this
table against a colour picker on the reference will otherwise wonder why the
numbers don't match exactly:

- **`muted` is not the reference's literal `#64748B`.** That value is
  already `subtle`, sitting at 4.51:1 against `canvas` — the lightest a
  colour can be here and still clear WCAG AA. Promoting it to `muted` too
  would collapse two of the three text steps into one. `muted` moved about
  halfway there instead (`#526074`), keeping all three steps distinct and
  every one of them individually AA-compliant.
- **`success-text` is darker than the reference's `~#169653`.** That value
  only reaches 3.6:1 on `success-subtle` — enough for a bold heading ("Great
  job!") but not for the regular-weight confirmation line beneath it.
  `#0E7A44` holds 4.5:1 while staying in the same teal-leaning green family.

`warning` and `danger` are untouched — neither state appears in the
reference (one screenshot, no error or caution state visible in it), and
both were checked for a clash against the new navy/blue/green and still
read as clearly distinct. Nothing was invented to fill a gap that isn't
actually there.

**Navy is structural, blue is interactive.** They are not interchangeable:
navy says "this is the frame of the application", blue says "this does
something". Nothing decorative uses either.

**Status colour applies to data, not chrome.** Green on a utilisation figure
means "healthy"; it is never applied because green looks nice.

### The sidebar is a fixed brand surface

Unlike every other surface in the app, the sidebar's tokens (`--app-sidebar-*`
in `globals.css`) live **outside** the `prefers-color-scheme: dark` block —
navy in both light and dark, because it is a brand anchor, not a workspace
surface. Its active-nav state is a solid Royal Blue pill (`sidebar-active-bg`)
and nothing else — no separate left accent bar, which would just be a second
indicator saying what the fill already says.
Because the default focus ring is `--app-primary` and would be low-contrast
on navy, `aside :focus-visible` (the sidebar is the only `<aside>` in the
app) overrides the ring colour to white.

The sidebar also carries the **profile control in its footer** on desktop
(avatar, name, role, chevron). On mobile there is no persistent sidebar, so
the profile stays in the header instead. Both are presentational shells over
one shared `useSignOut()` hook — the behaviour has a single definition even
though the two surfaces are styled differently. See `AppShell.tsx`.

### Workload categories

A closed palette — `--cat-teaching`, `--cat-learning`, `--cat-meeting`,
`--cat-admin`, `--cat-support`, `--cat-deliverable`, `--cat-research`,
`--cat-opening`/`--cat-closing`, `--cat-other`, and `--cat-unutilized` — used
only by the chart primitives via `categoryColor(code)` in `charts.tsx`. Fixed
assignment by activity-type code, never by array index, so adding a category
cannot recolour Teaching. Deliberately muted rather than saturated so a
distribution chart stays professional and never competes with a real status
signal:

| Category | Colour |
|---|---|
| Teaching | Primary blue `#2F6FED` |
| Learning | Indigo `#6366D1` |
| Meetings | Teal `#2A9D9D` |
| Administrative | Orange `#D99020` |
| Support | Green `#1F9D68` |
| Other | Grey `#8A95A3` |

**Unutilized capacity is drawn hatched (`.hatched`), never as a solid
colour** — it is the absence of recorded work, and a solid swatch would read
as a category of its own, which is the exact "no data"-vs-"zero hours"
confusion this product exists to prevent.

## Typography

**Two typefaces, on purpose.** Geist (`--font-sans`) is everything: body copy,
controls, table cells, labels, and every number — its tabular figures are why
numbers stay on it even under a serif heading. Source Serif 4
(`--font-display`, `layout.tsx`) is used in exactly two places: the NIAT
wordmark and page titles (`PageHeader`'s `<h1>`, via the `font-display`
utility). That is the entire scope of the departure — never body copy, never a
card title, never a number, never a button. A single restrained typographic
accent, applied consistently, is what gives the product a voice without
turning it into two products.

| Use | Class |
|---|---|
| Wordmark / page title | `font-display text-2xl sm:text-3xl font-semibold tracking-tight` |
| Card title | `text-base font-semibold` (Geist) |
| Headline number | `text-2xl` / `text-3xl` when emphasised (Geist, `.tabular`) |
| Body / table cell | `text-sm` (Geist) |
| Label / caption | `text-xs uppercase tracking-wide text-muted` (Geist) |

Hierarchy is **weight and colour first, size second**. Four sizes is enough; a
fifth usually means the layout needs rethinking rather than another step.

**Numbers use `.tabular`.** Figures must align column to column, or scanning a
workload table means re-reading every row.

## Spacing and radius

Spacing: `gap-4` between cards in a grid, `space-y-6`/`space-y-8` between page
sections, `px-5 py-4` inside card headers, `px-4 py-3` in table cells.

Radius is **role-named, not size-named** — `rounded-control` (buttons, inputs,
8px), `rounded-card` (cards, dialogs, 12px), `rounded-chip` (legend swatches
and other small non-status elements, 4px), and `rounded-pill` (fully round —
reserved for `Badge`/`StatusPill` and other status/tag/compact-metadata use).
That reservation is explicit and deliberate: pills are for status, not for
buttons or cards. "Everything is a pill" is what makes a dashboard read as a
template rather than a considered product.

## Components

| Component | Use |
|---|---|
| `PageHeader` / `Section` / `Breadcrumb` | Page and section scaffolding |
| `Card` / `CardHeader` / `CardBody` | Every panel |
| `Button` / `ButtonLink` / `IconButton` | `primary` \| `secondary` \| `ghost` \| `danger`. Icon-only buttons require a `label` — the type system won't build one without it |
| `Field` + `inputClass` / `Select` / `SearchInput` | Every form control |
| `FieldGroup` / `FilterBar` | Grouped form sections; compact, resettable filter rows |
| `Table` family | `TableWrap` → `Table` → `THead` (optionally sortable) → `TBody`/`TR`/`TD` |
| `CardList` / `CardListItem` | The **mobile** half of every data table — see Responsive below |
| `Badge` / `Dot` / `StatusPill` | Status. `StatusPill` reads from the shared `STATUS` vocabulary so the same state never gets two names on two pages |
| `StatTile` | Headline numbers, now with `delta`, `status` and `timeframe` — a KPI, not just a number in a box |
| `Meter` | A percentage as a bar plus its value, optionally with a target tick |
| `EmptyState` / `ErrorState` / `Alert` | The non-happy paths |
| `Skeleton`, `StatGridSkeleton`, `TableSkeleton`, `ChartSkeleton` | Loading |
| `Dialog` / `ConfirmDialog` (interactive.tsx) | Built on native `<dialog>` — focus trap, Escape, backdrop click, focus restoration all come free |
| `ToastProvider` / `useToast()` (interactive.tsx) | Transient confirmation only — never information the user must re-read |
| `Tabs` (interactive.tsx) | Only where they reduce complexity, never as decoration |
| `PeriodSelector` / `periodQuery()` (interactive.tsx) | The one period control. `null` means "let the server resolve it in the university's own timezone" |
| `InsightCard` (interactive.tsx) | The one AI-insight component, severity-varied, always showing its `sourceMetrics` beside the narration |
| `ChartCard` / `TrendLine` / `BarCompare` / `AllocationBar` / `Sparkline` (charts.tsx) | See Charts below |

### Two behaviours worth knowing

**`StatTile` renders `null` as "Not measurable", never as 0.** The distinction
between "we measured zero" and "there was nothing to measure" is load-bearing
throughout this product, and it has to survive all the way to the screen.

**Utilisation and compliance carry a tone AND a word**, from
`utilizationTone()`/`utilizationLabel()` and `complianceTone()`/
`complianceLabel()` in `ui.tsx`. Colour is never the only signal (WCAG 1.4.1):

- Utilisation: `>100%` danger "Over capacity" · `≥75%` success "On track" ·
  `≥60%` warning "Below target" · below that danger "Low utilization"
- Compliance: `≥90%` success "Compliant" · `≥50%` warning "Needs attention" ·
  below that danger "At risk"

## Charts

Written, not installed (`charts.tsx`). The product needs a trend line, a
capacity-vs-recorded bar comparison, and a 100%-stacked allocation bar — three
shapes — and pulling in a general-purpose charting library to draw them would
outweigh the rest of the dependency list (the whole app has nine production
dependencies). The technique: SVG with `preserveAspectRatio="none"` so the
shape layer stretches freely, `vector-effect="non-scaling-stroke"` so line
weight stays constant under that stretch, and all text kept in HTML beside the
SVG rather than inside it, so labels never shrink on a narrow screen.

**Null values are gaps, not zeroes.** `TrendLine` breaks the line across a day
with no records rather than dropping it to the axis — plotting "no data" as 0
is exactly the misreading this product exists to prevent, and a chart must not
reintroduce it. No chart computes a total, an average, or a derived figure; each
one takes numbers the server already calculated and draws them.

Every chart is titled as the question it answers (`ChartCard`'s `question`
prop), never a generic label — "How much of each day did you use?", not
"Activity overview".

## Loading, empty and error states

**Skeletons mirror the shape they replace** (`StatGridSkeleton`,
`TableSkeleton`, `ChartSkeleton`), so the page does not jump when data lands.

**Every list that can legitimately be empty has an `EmptyState`** naming what is
missing and, where there is one, the action that fills it.

**Errors are written for the person reading them**, via `ErrorState` and
`readError()` in `_lib/api.ts`: the server's own reason is shown when it is
about the request ("endTime must be after startTime"), and a plain sentence
otherwise — never a raw status code or stack trace.

## Application shell and navigation

Navy sidebar (240px) + clean white sticky header (`AppShell.tsx`) — the
sidebar carries the brand and the profile footer, the header stays quiet
(notifications, and on mobile the profile; no heavy shadow, no second
colour). **One shell, one navigation component (`nav.tsx`), all three
roles** — a role is distinguished by its menu contents and a small label,
never by re-colouring the chrome. Below `lg` the sidebar becomes a drawer
using the identical markup and the identical navy treatment, so mobile
navigation cannot drift from desktop navigation into a second
implementation.

Every role's navigation matches the brief's exact ordering:

- **Admin (9):** Overview, Universities, Managers, Instructors, Analytics, AI
  Insights, Reports, Audit Logs, Settings
- **Manager (9):** Overview, Instructors, Schedule, Workload, Deliverables,
  Analytics, AI Insights, Reports, Settings
- **Instructor (7):** Today, Schedule, Activities, Learning, Deliverables,
  Analytics, Profile

Every `href` points at a route that renders — there are no placeholders.

## Responsive

**Wide tables scroll inside `TableWrap`, never the page body.** Below `md`,
tables are not shrunk — they are replaced by `CardList`/`CardListItem`, a
compact two-line row (name + the one status that matters) with the rest
available on the detail page or an expanding drawer. This is a real second
render path (`hidden md:block` / `md:hidden`), not a CSS trick pretending a
grid is a table.

## Accessibility

- One focus ring everywhere (`*:focus-visible` in globals.css), visible in
  both themes.
- A skip-to-content link is the first tab stop on every authenticated page.
- `Dialog` is a native `<dialog>` — focus trap, Escape, and focus restoration
  are the browser's, not hand-rolled.
- Every icon-only control goes through `IconButton`, which requires a `label`
  prop at the type level.
- Status is never colour-only: every tone pairs with a word (`StatusPill`,
  `utilizationLabel`, `complianceLabel`).
- `prefers-reduced-motion` collapses all transition/animation durations
  (unchanged from Phase 11).

## Deliberately avoided

Gradients, glassmorphism, heavy shadows, decorative animation, pie charts,
and pill-shaped buttons/cards/inputs (pills are reserved for status). Navy or
blue used to decorate a card that isn't structural or interactive is exactly
the drift the 70/15/5 neutral/navy/blue split exists to prevent — and a dark
*dashboard* (as opposed to a dark sidebar) is the same mistake at page scale.
Depth comes from borders and background steps, not shadow.

## What this pass did not touch

Per the phase brief, this was presentation-only. No schema, API contract,
authorization rule, analytics calculation, or business rule changed. Three
things worth recording rather than silently working around:

- **No cross-tenant "list all managers" or "list all platform insights"
  endpoint exists.** The Admin Managers and Admin AI Insights pages assemble
  their view from the existing per-university endpoints (one request per
  university, in parallel) rather than adding a new route. A genuinely
  `PLATFORM`-scoped `AiInsight` (the schema supports one) would not appear on
  the Admin Insights page, because no endpoint lists them — this is a real
  backend gap, reported here rather than patched with a new route in this pass.
- **No account/password-change endpoint exists**, so Settings pages show
  account identity as read-only.
- **No `frontend-design` skill was present** in this environment (checked
  `/mnt/skills/public/`, the user skill directory, and the project's own
  `.claude/skills/`) — this pass followed the brief's own design-philosophy
  sections directly instead of substituting an unrelated system.
- **The university list cannot show Status, Risk, Deliverable health or
  Last-activity.** Checked both `/api/universities` and `/api/admin/overview`
  end to end — none of those four fields exist anywhere in either response.
  Utilization and compliance genuinely do exist (from the same rollup the
  platform Overview page reads) and are now merged into the Universities table
  for exactly that reason; the other four are left out rather than invented,
  since fabricating them would violate the "no mock data" rule and adding them
  for real means a backend change, which is outside a presentation-layer pass.

---

# The public website

The marketing site at `/`, `/platform`, `/solutions/*`, `/ai-intelligence`,
`/analytics`, `/security`, `/resources` and `/contact` shares this design
system's **tokens** but not its **density**. That distinction is the whole
design brief for the public surface.

## Same tokens, different density

The product and the marketing site have opposite jobs. A dashboard is
data-dense — small type, tight rows, many figures per screen. A marketing
page is editorial — a much larger type scale, far more whitespace, one idea
per band. Reusing `Card`/`PageHeader` on the public site would drag dashboard
density onto pages that need to breathe, so the public surface has its own
primitives in [`_components/public/marketing.tsx`](src/app/_components/public/marketing.tsx).

What is genuinely shared, and what makes the two halves recognisably one
product: every colour, radius, shadow and font token; `ButtonLink` for every
CTA; `Field`/`Select`/`inputClass`/`Alert`/`Button` for the demo form; and the
icon set.

| Public primitive | Role |
|---|---|
| `Band` | A full-width section. `tone` (`canvas` / `surface` / `soft` / `navy`) sets the background step — the page gets its rhythm from alternating bands, not from wrapping everything in cards |
| `SectionHeading` | Eyebrow + heading + lede. `as` separates heading LEVEL from visual SIZE so each page keeps exactly one `h1` |
| `Eyebrow` | Small uppercase label above a heading |
| `FeatureCard` | Bordered capability block, for genuine grids of peers |
| `CapabilityItem` | A checked line in a capability list |
| `Step` | A numbered step; the number is the anchor rather than an icon |
| `BrowserFrame` | Restrained product chrome — no fake macOS traffic lights, no invented URL |
| `IllustrativeNote` | The disclosure printed under every product visual |
| `CTABand` | The navy closing call-to-action |

## Type scale

Marketing headlines use **Geist** (the configured sans), not the serif
`font-display`. The serif is reserved for the NIAT wordmark alone, exactly
as in the product — so the brand mark is identical across the boundary while
the body voice stays a professional sans.

| Use | Size |
|---|---|
| Hero `h1` | `text-4xl` → `sm:text-5xl` → `lg:text-6xl` |
| Section `h2` | `text-3xl` → `sm:text-4xl` → `lg:text-[2.75rem]` |
| Lede | `text-lg` → `sm:text-xl` |
| Body | `text-base` / `text-sm` |
| Eyebrow | `text-xs uppercase tracking-[0.12em]` |

## Product previews are markup, not screenshots

[`DashboardPreview.tsx`](src/app/_components/public/DashboardPreview.tsx)
rebuilds the Admin, Manager and Instructor dashboards **in markup, from the
same CSS variables the product uses** — `--app-sidebar-bg`, `--color-primary`,
`--color-line`, the category palette, the radius scale.

This was not the first choice; it is the better one. There are no screenshot
assets in this repository and no capture tooling in the environment, and the
alternatives were a stock image or an invented dashboard that contradicts the
real product. Rebuilding from tokens instead means the previews **cannot drift
from the product's palette**, stay crisp at any resolution, reflow on a phone
rather than becoming unreadably small, keep their text selectable and
screen-reader accessible, and cost a few KB of HTML instead of a large image.

Every figure in them is representative, and every preview is published with
`IllustrativeNote` saying so. When real screenshots exist, swapping them in
means replacing the body of three components — `BrowserFrame` and all call
sites stay as they are.

## Rules the public site enforces

- **No fabricated proof.** No customer counts, logos, testimonials, case
  studies, revenue or adoption figures anywhere. The capability strip sells
  capability, not social proof that does not exist.
- **No invented certifications.** `/security` states plainly that NIAT
  holds no SOC 2, ISO 27001, HIPAA, GDPR or FERPA certification, and the file
  carries a comment telling the next editor not to add badges. A compliance
  claim a procurement team can disprove in one email is worse than no badge.
- **Only links that exist.** The footer has no About, Careers, Privacy or
  Terms columns because those pages are not built. Add the column when the
  page exists.
- **Opening and closing shown correctly.** `OpeningClosingTimeline` renders a
  single opening at the top of the day and a single closing at the bottom,
  with ordinary work between — so the university-workday rule is self-evident
  from the visual rather than something the copy has to argue against.
- **The capacity model survives into marketing.** `WorkloadVisualization`
  shows recorded work, unutilized capacity (hatched) and missing data as three
  separate things, exactly as the product does.
- **Dropdowns open on click.** Hover-only menus are unreachable by keyboard
  and hostile on touch; `PublicNavbar` uses click-to-open with Escape and
  outside-click dismissal.
- **The role switcher is a real tablist.** Arrow keys, Home/End, and
  `aria-controls`/`aria-selected`. Panels are toggled with `hidden` rather
  than conditionally mounted, so switching never shifts page height.
