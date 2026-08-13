# Vaultage Community Design System

## 1. Atmosphere & Identity

Vaultage Community is a quiet local command center: dark, dense when work is
active, and calm when the vault is empty. The UI2026 reference uses layered
green-black surfaces with a restrained violet action accent; the signature is
secure, tactile depth without decorative noise.

## 2. Color

The existing UI2026 stylesheet is the source of truth. Components use semantic
tokens rather than raw color values.

Legacy control aliases (`accent`, `accent-hover`, and focus/shadow variants)
resolve to the matching UI2026 action tokens. They exist only to keep established
workflow components visually compatible while those components are composed with
UI2026 surfaces; they never repurpose the success green as a primary action.

| Role | Token | Usage |
|---|---|---|
| Background | --ui26-bg | App canvas |
| Rail | --ui26-rail | Context navigation |
| Surface | --ui26-surface / --ui26-surface-raised | Panels and cards |
| Primary text | --ui26-text | Headings and body |
| Secondary text | --ui26-text-secondary | Supporting copy |
| Muted text | --ui26-text-muted | Metadata and hints |
| Accent | --ui26-accent / --ui26-accent-hover | Actions and links |
| Focus | --ui26-focus | Keyboard focus |
| Status | --ui26-success, --ui26-warning, --ui26-danger, --ui26-info | State communication |
| Modal canvas | --liquid-modal-surface / --liquid-modal-overlay | Neutral modal surface and backdrop; no hue amplification |

## 3. Typography

The UI2026 scale is tokenized in src/renderer/src/ui2026/ui2026.css under
--ui26-type-*, --ui26-weight-*, and --ui26-leading-*. The primary stack is
Inter with the platform sans-serif fallbacks already declared by the stylesheet.

## 4. Spacing & Layout

Spacing uses the --ui26-space-* tokens, based on a 4px rhythm. App shells use
the bounded grid and scroll ownership declared by .ui26-shell,
.ui26-workspace, and .ui26-main; the main region owns content overflow.

## 5. Components

### Authentication and onboarding

- Scope: clean-install welcome, local-vault password creation, Emergency Kit
  restore entry, and the backdrop shared by those setup steps. Established
  unlock and recovery screens remain on their existing auth contract until
  they are migrated deliberately.
- Primitives: `ui26-onboarding-shell`, `ui26-onboarding-frame`,
  `ui26-onboarding-action-card`, `ui26-onboarding-security`,
  `ui26-onboarding-form-panel`, `ui26-onboarding-field`,
  `ui26-onboarding-strength-meter`, and `ui26-onboarding-callout`. Their
  component tokens and states live in the ordered
  `src/renderer/src/ui2026/onboarding*.css` family; onboarding components do
  not carry inline visual styles or arbitrary color, type, radius, shadow, or
  spacing values.
- Color: violet `--ui26-accent*` is the primary action and
  `--ui26-focus` is the keyboard focus role in both editions. Green
  `--ui26-success` appears only when password strength reaches the genuine
  success state. Warning, danger, and info use their matching semantic tokens.
- Type and layout: step titles use the UI2026 title scale, controls and labels
  use the label scale, and security/recovery explanations use the body scale.
  The shell owns scrolling, setup frames use named width/inset tokens, and
  security facts reflow from one column below 480px to three columns above it.
- States: welcome rest/focus/press; password focus, policy error, mismatch,
  valid, loading, and setup error; restore entry; Back/Escape return; normal
  and reduced motion. Every raw onboarding button has an explicit 2px
  `--ui26-focus` outline. Reduced motion removes entrances, transforms, and
  progress transitions while keeping every control immediately usable.
- Closed-edition welcome variants: the primary local-vault path and a quieter
  account-directed path share the action-card primitive. The account path does
  not weaken or bypass local encryption: it explains that the user creates the
  local vault and mandatory Emergency Kit first, then opens Account & Plan in
  the browser for account access. Community never renders this
  commercial path. Returning Back and choosing local setup replaces the pending
  destination so Account & Plan cannot open unexpectedly.
- Accessibility: each step has one `h1`; security facts precede password
  entry; secure inputs retain native semantics; invalid fields expose
  `aria-invalid` and associated descriptions; stable `data-onboarding-*`
  markers support behavior and visual QA without pinning customer prose.

### Marketing hero

- Structure: an informational left column and a dimensional secure-object media
  frame on wide screens; the same elements become a single readable vertical
  sequence below the `lg` breakpoint. Primary account and download actions
  remain visible before the media on compact screens.
- Tokens: `--marketing-hero-accent-*` defines the restrained violet-to-cyan
  emphasis; `--marketing-hero-media-radius`, `--marketing-hero-media-shadow`,
  and `--marketing-hero-media-glow` define the one elevated media treatment.
  `--marketing-hero-content-*`, `--marketing-hero-section-*`,
  `--marketing-hero-gap-*`, `--marketing-hero-heading-*`,
  `--marketing-hero-copy-*`, `--marketing-hero-grid-*`, and
  `--marketing-hero-media-glow-*` define the responsive 4:3 composition,
  spacing, type scale, and media lighting. These are declared in
  `marketing-web/src/index.css`; new hero code uses the corresponding
  `marketing-hero-*` classes rather than one-off values.
- Motion: the media video is the only decorative motion. It is muted, looping,
  inline, and has no native controls. `prefers-reduced-motion` renders the
  static poster instead; the frame itself has no entrance animation.
- Accessibility: media has an accessible label and an SR-only caption; the
  poster preserves the same 4:3 geometry to prevent layout shift.

### Web account management shell

- Structure: a full-height `AccountConsole` with a persistent product rail, a
  compact utility header, and one independently scrolling main region. At
  compact widths the rail becomes a top identity row and the section controls
  become a horizontally scrollable navigation strip.
- Sections: home, profile, security, sessions, billing, and devices/data. Home owns setup
  guidance, the optional MFA recommendation, and desktop product handoffs; WorkOS widgets own identity, factor,
  password, and hosted-session mutations; billing loads authoritative Control
  account state and opens Stripe-hosted Checkout or the customer portal from
  the signed-in website.
- React primitives: `AccountSectionNav`, `AccountOverview`,
  `AccountProductCard`, `AccountBilling`, `BillingStatePanel`, and
  `AccountBoundaryNote`. Billing choices use a two-card intrinsic grid, while
  loading, provider-error, and recent-auth states retain the shared console
  surface and action hierarchy. CSS layout primitives
  `account-console`, `account-console-sidebar`, `account-utility-bar`, and
  `account-content-section` share the account-console surface, border, type,
  focus, and action tokens.
- Theme tokens: `--account-canvas`, `--account-sidebar`, `--account-surface`,
  `--account-surface-raised`, `--account-surface-hover`, `--account-border`,
  `--account-border-strong`, `--account-text`, `--account-text-secondary`,
  `--account-text-muted`, `--account-accent`, `--account-accent-strong`, and
  `--account-focus`. Dark is the default; light is an explicit persisted user
  preference. Both modes preserve the same hierarchy and semantic status
  colors.
- Scale tokens: `--account-space-1` through `--account-space-8`,
  `--account-radius-sm` through `--account-radius-xl`,
  `--account-type-caption` through `--account-type-label`, and
  `--account-motion-fast` / `--account-motion-standard` provide the reusable
  spacing, shape, typography, and interaction cadence for account primitives.
- Scroll ownership: `AccountConsole__workspace` is bounded to `100dvh`; only
  `AccountConsole__main` owns vertical scrolling on wide screens. The compact
  layout returns scrolling to the document and never nests primary scrollbars.
- States: loading, signed out, signed in, active section, keyboard focus,
  provider error, desktop download temporarily unavailable, long display
  name/email, dark/light theme, and compact single-column reflow. An unavailable
  customer binary is plain status text or a disabled native action, never a
  retained download link styled as available.
- Optional MFA state: authenticated Vaultage surfaces may recommend MFA and
  deep-link to Account Security. Until WorkOS exposes the factor state through
  the existing browser widget, the dashboard and desktop must describe status
  as available for review rather than claim enabled or disabled. Signup never
  contains an MFA prerequisite owned by Vaultage.
- Boundary: the website may manage WorkOS identity, hosted sessions, and
  subscription billing. It sends only a WorkOS access token plus symbolic
  monthly/annual intent to Control; Stripe keys, Price IDs, customer IDs, and
  subscription IDs never enter browser code. Production Checkout returns use
  the canonical non-www `/billing/success` and `/billing/cancel` routes, and
  portal sessions return to `/account`; Checkout and portal destinations are
  accepted only on exact Stripe-hosted origins. Billing mutations that require
  recent authentication use the AuthKit-generated PKCE URL with exact
  `max_age=0`, then restore the Billing section through a fixed, same-origin
  return state. Vaultage device, export, and deletion
  actions remain desktop-owned because they require the enrolled device and
  local confirmation; desktop billing settings remain a fallback for refreshing
  local Services access, not the primary billing surface.
- Accessibility: semantic header/nav/main landmarks, `aria-current` on the
  selected section, descriptive action labels, visible focus, and status text
  that never relies on color alone.

### Documentation shell

- Structure: a compact product header, persistent grouped documentation rail,
  one readable article column, and a sticky in-page table of contents. Mobile
  collapses both navigation columns into native disclosure panels before the
  article; the document remains the only scrolling owner.
- Primitives: `DocsHeader`, `DocsSidebar`, `DocsBreadcrumbs`, `DocsArticle`,
  `DocsTableOfContents`, `DocsSearch`, `DocsStatus`, and `DocsPager`. Every docs
  route is rendered from typed, searchable page metadata rather than bespoke
  page markup.
- Tokens: docs CSS aliases the marketing system's `--color-bg`,
  `--color-surface`, `--color-border`, `--color-ink*`, and `--color-primary*`
  tokens. Spacing remains on the shared 4px rhythm; article measure is bounded
  for scanning and long-form readability.
- States: current navigation/page, search idle/results/no-match, open/closed
  mobile navigation, Available/Coming soon status, keyboard focus, code overflow,
  and previous/next destinations.
- Motion: only interactive color, opacity, and disclosure-state feedback; the
  documentation canvas has no decorative motion.
- Accessibility: header/nav/main/aside landmarks, skip link, labelled search,
  `aria-current`, visible focus, semantic lists/tables/code, heading anchors,
  and status text that never relies on color alone.
- Boundary: the public docs describe only current product contracts and name
  unavailable work explicitly. Provider availability is always projected to
  exactly Available or Coming soon.

### UI2026 shell

- Structure: skip link, optional context rail, bounded workspace, optional command header, main landmark.
- Variants: embedded and full shell; headerless workspace.
- States: default and keyboard-focusable main landmark.
- Accessibility: semantic aside, main, and skip link; no tab-panel role for navigation.
- Compact legacy-workspace variant: the established navigation rail becomes an
  explicit labelled drawer below the compact breakpoint. The main workspace
  retains full inline width; the drawer and its scrim are separate controls so
  navigation remains keyboard reachable without permanently constraining detail
  content. The desktop window may shrink to the compact composition (640px
  minimum inline size) rather than preventing that tested responsive state.

### Surface navigation

- Structure: semantic nav containing roving surface buttons.
- Variants: available Vault/Projects surfaces; optional closed-only Services
  availability, with saved connections still visible/actionable when lifecycle
  creation is gated.
- States: current, unavailable, focused.
- Accessibility: aria-current page, arrow-key navigation, stable control IDs, and focus restoration after remount.

### Search trigger

- Structure: button with a scoped accessible label and optional keyboard hint.
- Variants: header and rail.
- States: default, hover, active, focus, disabled by the caller.
- Accessibility: native button semantics and stable opt-in IDs.

### Surface primitives

SurfaceHero, SurfaceSectionHeader, MetricTile, Panel, CompactRow, EnvBadge,
StatusMark, CountChip, ActionButton, EmptyFirst, QuickActionCard, ContextRail,
RailSection, and RailStatSplit are reusable Vault/Projects building blocks.
Their states are represented by the existing CSS classes and focused
server-render tests.

DashboardPanel is the universal module wrapper for Vault and Projects metrics,
pinned content, issues/reminders, and general activity. Those four modules share
the same header, count, body, state, border, radius, and surface tokens; content
type changes inside the body rather than selecting a different outer shell.

Services uses one persistent ServicesCommandBar across discovery, category,
use-case, industry, provider overview, setup, and connected-service routes. It
owns the route breadcrumb/back action, scoped search trigger, and Request a
service CTA. Category navigation belongs to the context rail and must not be
duplicated as a second landing-page category module. Services catalog sections
reuse DashboardPanel, while provider and destination content reuse the same
surface, border, radius, and tonal tokens as Vault/Projects and the standalone
provider overview.

### Vault surface

- Structure: command header, optional context rail, local metrics, pinned secrets, quick actions, reminders, recent secrets, pinned collections, and scoped search results.
- States: empty first-use guidance, populated local vault, filtered results, and no-match search feedback.
- Behavior: selecting a secret or collection hands off to the existing local Vault workspace, preserving CRUD, folders, drag/drop, import/export, backup/restore, and selection behavior.
- Boundary: Community renders only local vault data and keeps Services, provider, agent, billing, and cloud surfaces out of the composition.
- Accessibility: shell landmarks, scoped search labels, native buttons, keyboard-focusable rows, and environment badges with full accessible names.

## 6. Motion & Interaction

The existing motion tokens are --ui26-motion-fast, --ui26-motion-standard, and
--ui26-motion-slow. Foundation controls animate only color/opacity and preserve
prefers-reduced-motion handling in the stylesheet. Keyboard movement is an
interaction contract, not decoration.

## 7. Depth & Surface

The system uses mixed tonal surfaces with subtle borders and restrained glass
sheen. Elevation is expressed by --ui26-surface-*, --ui26-glass-*, and
--ui26-border-*; foundation components do not introduce new ad-hoc shadows.
Modal surfaces use the neutral --liquid-modal-* tokens and remove saturation
from the backdrop filter so dialogs retain the app canvas character without a
green cast. The shared DialogContent primitive defaults to a wide max-width;
individual forms may remain narrower when their content benefits from it.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA: visible focus, keyboard reachability, semantic landmarks,
accessible names for controls, and no hidden Services control in the Community
edition. The Vault surface has focused server-render coverage; full visual QA
of the composed Vault and Projects screens remains a release-stage check.
