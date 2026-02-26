# Accessibility Implementation Guide

## Overview

This document provides technical details about the accessibility implementation in VaultDAO, including architecture, components, and best practices for developers.

## Architecture

### Context Providers

#### AccessibilityContext

Located in `frontend/src/contexts/AccessibilityContext.tsx`

Manages global accessibility settings:

```typescript
interface AccessibilitySettings {
  highContrast: boolean;
  textScale: number; // 1.0 to 2.0
  reducedMotion: boolean;
  keyboardShortcutsEnabled: boolean;
}
```

**Features:**
- Persists settings to localStorage
- Respects system preferences (prefers-reduced-motion, prefers-contrast)
- Applies settings to document root
- Provides screen reader announcement utility

**Usage:**
```typescript
import { useAccessibility } from '../contexts/AccessibilityContext';

function MyComponent() {
  const { settings, toggleHighContrast, announceToScreenReader } = useAccessibility();
  
  // Use settings
  if (settings.highContrast) {
    // Apply high contrast styles
  }
  
  // Announce to screen reader
  announceToScreenReader('Action completed', 'polite');
}
```

### Custom Hooks

#### useFocusTrap

Located in `frontend/src/hooks/useFocusTrap.ts`

Traps focus within a modal or dialog:

```typescript
import { useFocusTrap } from '../../hooks/useFocusTrap';

function Modal({ isOpen }) {
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen);
  
  return (
    <div ref={modalRef} role="dialog" aria-modal="true">
      {/* Modal content */}
    </div>
  );
}
```

**Features:**
- Automatically focuses first focusable element
- Cycles focus within the container
- Restores focus on unmount
- Handles Tab and Shift+Tab

#### useKeyboardShortcut

Located in `frontend/src/hooks/useKeyboardShortcut.ts`

Registers keyboard shortcuts:

```typescript
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';

function MyComponent() {
  useKeyboardShortcut(
    { key: 'n', ctrlKey: true },
    () => {
      // Handle Ctrl+N
    }
  );
}
```

### Components

#### SkipLinks

Located in `frontend/src/components/SkipLinks.tsx`

Provides skip navigation links for keyboard users:

```tsx
<SkipLinks />
```

**Features:**
- Hidden by default
- Visible on keyboard focus
- Links to main content areas
- Styled with high visibility

#### KeyboardShortcuts

Located in `frontend/src/components/KeyboardShortcuts.tsx`

Displays available keyboard shortcuts:

```tsx
<KeyboardShortcuts shortcuts={shortcuts} />
```

**Features:**
- Toggle with `?` key
- Categorized shortcuts
- Modal dialog with focus trap
- Escape key to close

#### AccessibilitySettings

Located in `frontend/src/components/AccessibilitySettings.tsx`

UI for managing accessibility preferences:

```tsx
<AccessibilitySettings />
```

**Features:**
- High contrast toggle
- Text scaling controls
- Reduced motion toggle
- Keyboard shortcuts toggle
- Accessible form controls

## CSS Implementation

### Base Styles

Located in `frontend/src/index.css`

#### Screen Reader Only

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

#### Skip Links

```css
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  padding: 1rem 1.5rem;
  background: #7c3aed;
  color: white;
}

.skip-link:focus {
  left: 0;
  outline: 3px solid #a78bfa;
  outline-offset: 2px;
}
```

#### Focus Indicators

```css
*:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
```

### High Contrast Mode

Applied when `.high-contrast` class is on `<html>`:

```css
.high-contrast body {
  background-color: #000000;
  color: #ffffff;
}

.high-contrast button:focus {
  outline: 3px solid #ffff00 !important;
  outline-offset: 2px;
}
```

### Reduced Motion

Applied when `.reduce-motion` class is on `<html>`:

```css
.reduce-motion *,
.reduce-motion *::before,
.reduce-motion *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
```

## ARIA Patterns

### Modal Dialogs

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-description"
>
  <h2 id="dialog-title">Dialog Title</h2>
  <p id="dialog-description">Dialog description</p>
  {/* Dialog content */}
</div>
```

### Form Inputs

```tsx
<div>
  <label htmlFor="email">Email</label>
  <input
    id="email"
    type="email"
    aria-required="true"
    aria-invalid={hasError}
    aria-describedby={hasError ? 'email-error' : undefined}
  />
  {hasError && (
    <p id="email-error" role="alert">
      {errorMessage}
    </p>
  )}
</div>
```

### Buttons

```tsx
<button
  onClick={handleClick}
  aria-label="Close dialog"
  aria-pressed={isPressed}
  disabled={isDisabled}
>
  <X aria-hidden="true" />
</button>
```

### Toggle Switches

```tsx
<button
  role="switch"
  aria-checked={isEnabled}
  aria-label="Enable notifications"
  onClick={toggle}
>
  <span className={isEnabled ? 'translate-x-6' : 'translate-x-1'} />
</button>
```

### Live Regions

```tsx
<div role="status" aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>

<div role="alert" aria-live="assertive">
  {errorMessage}
</div>
```

## Best Practices

### 1. Semantic HTML

Use semantic HTML elements:

```tsx
// Good
<nav>
  <ul>
    <li><a href="/dashboard">Dashboard</a></li>
  </ul>
</nav>

// Bad
<div className="nav">
  <div className="nav-item" onClick={navigate}>Dashboard</div>
</div>
```

### 2. Keyboard Navigation

Ensure all interactive elements are keyboard accessible:

```tsx
// Good
<button onClick={handleClick}>Click me</button>

// Bad
<div onClick={handleClick}>Click me</div>
```

### 3. Focus Management

Manage focus appropriately:

```tsx
useEffect(() => {
  if (isOpen) {
    // Focus first element in modal
    firstElementRef.current?.focus();
  }
}, [isOpen]);
```

### 4. ARIA Labels

Provide descriptive labels:

```tsx
// Good
<button aria-label="Close dialog">
  <X aria-hidden="true" />
</button>

// Bad
<button>
  <X />
</button>
```

### 5. Error Handling

Link errors to inputs:

```tsx
<input
  id="email"
  aria-invalid={hasError}
  aria-describedby="email-error"
/>
{hasError && (
  <p id="email-error" role="alert">
    {errorMessage}
  </p>
)}
```

### 6. Loading States

Announce loading states:

```tsx
<button disabled={isLoading} aria-label={isLoading ? 'Loading...' : 'Submit'}>
  {isLoading ? <Spinner aria-hidden="true" /> : 'Submit'}
</button>
```

### 7. Touch Targets

Ensure minimum touch target size:

```tsx
<button className="min-h-[44px] min-w-[44px] p-3">
  <Icon />
</button>
```

## Testing

### Manual Testing Checklist

- [ ] Navigate entire app with keyboard only
- [ ] Test with screen reader (NVDA/JAWS/VoiceOver)
- [ ] Verify focus indicators are visible
- [ ] Test modal focus trapping
- [ ] Check color contrast ratios
- [ ] Test at 200% zoom
- [ ] Enable high contrast mode
- [ ] Enable reduced motion
- [ ] Test on mobile devices
- [ ] Verify touch target sizes

### Automated Testing

Install axe-core for React:

```bash
npm install --save-dev @axe-core/react
```

Add to development environment:

```typescript
// main.tsx (development only)
if (import.meta.env.DEV) {
  import('@axe-core/react').then((axe) => {
    axe.default(React, ReactDOM, 1000);
  });
}
```

### Browser Extensions

- **axe DevTools**: Comprehensive accessibility testing
- **WAVE**: Visual accessibility evaluation
- **Lighthouse**: Chrome DevTools audit
- **ANDI**: Accessibility testing tool

## Common Issues and Solutions

### Issue: Focus not visible

**Solution:** Ensure focus-visible styles are applied:

```css
*:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
```

### Issue: Screen reader not announcing changes

**Solution:** Use live regions:

```tsx
<div role="status" aria-live="polite">
  {message}
</div>
```

### Issue: Modal focus not trapped

**Solution:** Use useFocusTrap hook:

```tsx
const modalRef = useFocusTrap<HTMLDivElement>(isOpen);
```

### Issue: Form errors not announced

**Solution:** Link errors with aria-describedby:

```tsx
<input aria-describedby="error-id" />
<p id="error-id" role="alert">{error}</p>
```

## Resources

- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM WCAG 2 Checklist](https://webaim.org/standards/wcag/checklist)
- [Inclusive Components](https://inclusive-components.design/)
- [A11y Project](https://www.a11yproject.com/)

## Maintenance

### Regular Audits

- Run automated tests monthly
- Conduct manual testing quarterly
- Test with real users annually
- Update documentation as needed

### Staying Current

- Monitor WCAG updates
- Follow accessibility blogs and newsletters
- Participate in accessibility communities
- Attend accessibility conferences

---

Last updated: February 2026
