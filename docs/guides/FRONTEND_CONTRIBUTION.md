# FRONTEND CONTRIBUTION — Design system, widgets, and testing (with a worked example)

This guide helps new frontend contributors add components and dashboard widgets **without violating the VaultDAO design system** or creating review churn.

It answers:

- What styling conventions you must follow (glassmorphism + Tailwind)
- How to build widgets that match the existing dashboard system
- What to test (and how)
- What reviewers look for

> The UI uses Tailwind + dark mode via `darkMode: 'class'`. The glassmorphism utilities are defined in `frontend/src/styles/themes.ts`. This guide references those _existing_ classes directly.

---

## Quick facts (read first)

- **Design system**: Glassmorphism utilities + Tailwind classes from the repo.
- **Dark mode**: Use `dark:` variants for any color/background/shadow changes.
- **Accessibility**: Any interactive element must have the appropriate accessible name and keyboard behavior.
- **Widget system**: Built-in dashboard widgets are registered in `frontend/src/components/WidgetLibrary.tsx` and rendered in `frontend/src/components/DashboardBuilder.tsx`.
- **Third-party widgets**: Installed widgets are sandboxed via `frontend/src/components/WidgetSandbox.tsx`.

---

## Estimated time per step

- Read the guide: **20–30 min**
- Add a component that matches the design system: **1–3 hours**
- Add a widget + tests: **2–6 hours**
- Get through review: **1–7 days** (depends on feedback)

---

## 1) Design system (glassmorphism + Tailwind conventions)

VaultDAO’s UI is largely built from:

1. **Tailwind theme + animation tokens** (from `frontend/tailwind.config.js`)
2. **Glass utility classes** (from `frontend/src/styles/themes.ts`)

### 1.1 Dark mode model

Tailwind config sets:

- `darkMode: 'class'`

That means:

- The root element (`document.documentElement`) has class `dark` when dark mode is active.
- You should use `dark:` variants, not JS-based hardcoded colors.

### 1.2 Glassmorphism tokens (exact utility classes)

The actual “glass” class strings live in `frontend/src/styles/themes.ts`.

Use these classes directly to stay consistent.

#### Glass panel

```ts
export const glassPanel =
  "bg-white/80 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-700/60 backdrop-blur-md shadow-sm dark:shadow-none contrast-more:bg-white contrast-more:border-slate-900";
```

#### Glass card

```ts
export const glassCard =
  "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl contrast-more:bg-white contrast-more:border-slate-900";
```

#### Glass modal

```ts
export const glassModal =
  "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl contrast-more:bg-black contrast-more:border-white";
```

### 1.3 Radius conventions

Common rounded values used across the codebase:

- **Rounded containers**: `rounded-lg`
- **Widgets/cards/modals**: `rounded-xl` (preferred for “glass”)

### 1.4 Shadows and borders

Existing widgets use subtle shadows and explicit borders:

- Cards: `shadow-sm` / `shadow-2xl` depending on context.
- Explicit borders with dark variants, e.g. `border-slate-200 dark:border-slate-700`.

### 1.5 Animation timing and transitions (exact tokens)

From `frontend/tailwind.config.js`:

- `fadeIn` = `fadeIn 0.3s ease-out both` → use `animate-fadeIn`
- `slideInUp` = `slideInUp 0.3s ease-out both` → use `animate-slideInUp`
- `slideInDown` = `slideInDown 0.3s ease-out both` → use `animate-slideInDown`
- `shimmer` = `shimmer 2s infinite linear` → use `animate-shimmer`
- `transitionDuration.250 = 250ms`

`frontend/src/styles/themes.ts` also defines:

- `.theme-transition` → `transition-colors duration-250`

Use `theme-transition` instead of inventing a new duration.

---

## 2) Component checklist (actionable + review-friendly)

### 2.1 Size limit

- Keep components **≤ 150 lines** (excluding imports and type definitions).
- If the component grows, split into smaller pieces.

### 2.2 Prop types

- Use explicit TypeScript types or interfaces.
- **Do not use `any`**.

### 2.3 Accessibility requirements

Reviewers expect you to:

- Provide an accessible name for interactive elements.
  - Icon-only buttons must have `aria-label`.
- Ensure keyboard access.
  - Use native `<button>` / `<a>` elements.

### 2.4 States you must handle

For data-driven UI, include at least:

- Loading
- Error
- Empty

Example: `frontend/src/components/widgets/GovernanceHealthWidget.tsx` shows loading + error UI.

---

## 3) Widget development guide (built-in dashboard widgets)

The built-in dashboard widgets flow is:

1. `frontend/src/components/WidgetLibrary.tsx` lists widget types and calls `onAddWidget(type)`
2. `frontend/src/components/DashboardBuilder.tsx` renders a widget via `renderWidgetContent` switch

### 3.1 Worked example: `DocInfoWidget`

A new contributor-friendly example widget is implemented as:

- `frontend/src/components/widgets/DocInfoWidget.tsx`

It demonstrates:

- dark mode variants
- consistent card styling
- accessible markup for links

### 3.2 Add it as a built-in widget

Edit these files:

#### Step A — extend the widget type union

- `frontend/src/types/dashboard.ts`

Add:

- `| 'doc-info'`

#### Step B — register in WidgetLibrary

- `frontend/src/components/WidgetLibrary.tsx`

Add a new entry in `widgetTypes`:

- `{ type: 'doc-info' as WidgetType, name: 'Doc Info', ... }`

#### Step C — render it in DashboardBuilder

- `frontend/src/components/DashboardBuilder.tsx`

Add an import:

- `import DocInfoWidget from './widgets/DocInfoWidget';`

And a new `case` in `renderWidgetContent`:

- `case 'doc-info': return <DocInfoWidget title={widget.title} />;`

---

## 4) Third-party widgets (sandboxed widgets)

Third-party installed widgets use an iframe sandbox:

- `frontend/src/components/WidgetSandbox.tsx`

Key conventions:

- `<iframe sandbox="allow-scripts">`
- `postMessage` bridge with widgetId checks
- Provide loading/error UI

---

## 5) Testing requirements (Vitest)

VaultDAO frontend uses Vitest configured in:

- `frontend/vitest.config.ts`

and the existing component tests live under:

- `frontend/src/components/__tests__/...`

For component/widget PRs:

- Add/extend tests for the new UI behavior
- Smoke test rendering and key interactive paths
- Cover loading/empty/error where applicable

---

## 6) Common pitfalls (what causes review rework)

### Pitfall A — hardcoded colors (no dark mode variants)

Use `dark:` variants or glass utilities.

### Pitfall B — missing required accessibility props

Icon-only buttons must have `aria-label`.

### Pitfall C — leftover debug logs

Avoid `console.log`/`console.error` in component code.

### Pitfall D — missing `key` props in lists

Always provide stable `key` values when mapping.

---

## 7) PR submission checklist

Before opening a PR:

- [ ] Component/widget follows styling conventions (glass + dark variants)
- [ ] ≤ 150 lines (or split into smaller parts)
- [ ] No `any`
- [ ] Accessibility checks done
- [ ] Tests added/updated
- [ ] No debug logs

---

## Summary

Use the existing Tailwind tokens and glass utility classes; keep components small and typed; provide accessibility + correct UI states; register widgets in `WidgetLibrary` + `DashboardBuilder`.
