# Vaultage Community Design System

## 1. Atmosphere & Identity

Vaultage Community is a quiet local command center: dark, dense when work is
active, and calm when the vault is empty. The UI2026 reference uses layered
green-black surfaces with a restrained violet action accent; the signature is
secure, tactile depth without decorative noise.

## 2. Color

The existing UI2026 stylesheet is the source of truth. Components use semantic
tokens rather than raw color values.

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

### UI2026 shell

- Structure: skip link, optional context rail, bounded workspace, optional command header, main landmark.
- Variants: embedded and full shell; headerless workspace.
- States: default and keyboard-focusable main landmark.
- Accessibility: semantic aside, main, and skip link; no tab-panel role for navigation.

### Surface navigation

- Structure: semantic nav containing roving surface buttons.
- Variants: available Vault/Projects surfaces; optional closed-only Services availability.
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
