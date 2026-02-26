# Accessibility Quick Reference

Quick reference guide for developers working on VaultDAO accessibility features.

## Common Patterns

### Button with Icon

```tsx
<button
  onClick={handleClick}
  aria-label="Close dialog"
  className="focus:outline-none focus:ring-2 focus:ring-purple-500"
>
  <X aria-hidden="true" />
</button>
```

### Form Input with Error

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

### Modal Dialog

```tsx
function Modal({ isOpen, onClose }) {
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen);
  
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50"
    >
      <div ref={modalRef}>
        <h2 id="modal-title">Modal Title</h2>
        {/* Content */}
      </div>
    </div>
  );
}
```

### Toggle Switch

```tsx
<button
  role="switch"
  aria-checked={isEnabled}
  aria-label="Enable notifications"
  onClick={toggle}
  className="focus:outline-none focus:ring-2 focus:ring-purple-500"
>
  <span className={isEnabled ? 'translate-x-6' : 'translate-x-1'} />
</button>
```

### Dropdown Menu

```tsx
<div>
  <button
    onClick={toggleMenu}
    aria-expanded={isOpen}
    aria-haspopup="true"
    aria-label="Open menu"
  >
    Menu
  </button>
  {isOpen && (
    <div role="menu">
      <button role="menuitem" onClick={handleAction1}>
        Action 1
      </button>
      <button role="menuitem" onClick={handleAction2}>
        Action 2
      </button>
    </div>
  )}
</div>
```

### Loading Button

```tsx
<button
  disabled={isLoading}
  aria-label={isLoading ? 'Loading...' : 'Submit'}
  className="min-h-[44px]"
>
  {isLoading ? (
    <Loader2 className="animate-spin" aria-hidden="true" />
  ) : (
    'Submit'
  )}
</button>
```

### Screen Reader Announcement

```tsx
import { useAccessibility } from '../contexts/AccessibilityContext';

function MyComponent() {
  const { announceToScreenReader } = useAccessibility();
  
  const handleAction = () => {
    // Perform action
    announceToScreenReader('Action completed successfully', 'polite');
  };
}
```

## CSS Classes

### Screen Reader Only

```tsx
<span className="sr-only">Hidden from visual users</span>
```

### Focus Styles

```tsx
<button className="focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900">
  Click me
</button>
```

### Touch Targets

```tsx
<button className="min-h-[44px] min-w-[44px] p-3">
  <Icon />
</button>
```

## Hooks

### Focus Trap

```tsx
import { useFocusTrap } from '../hooks/useFocusTrap';

const modalRef = useFocusTrap<HTMLDivElement>(isOpen);
```

### Keyboard Shortcut

```tsx
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';

useKeyboardShortcut(
  { key: 'n', ctrlKey: true },
  () => createNew()
);
```

### Accessibility Settings

```tsx
import { useAccessibility } from '../contexts/AccessibilityContext';

const {
  settings,
  toggleHighContrast,
  increaseTextScale,
  announceToScreenReader
} = useAccessibility();
```

## ARIA Attributes

| Attribute | Usage | Example |
|-----------|-------|---------|
| `aria-label` | Label for elements without visible text | `<button aria-label="Close">×</button>` |
| `aria-labelledby` | Reference to element containing label | `<div aria-labelledby="title-id">` |
| `aria-describedby` | Reference to element with description | `<input aria-describedby="error-id">` |
| `aria-required` | Mark required form fields | `<input aria-required="true">` |
| `aria-invalid` | Mark invalid form fields | `<input aria-invalid="true">` |
| `aria-expanded` | Indicate expanded/collapsed state | `<button aria-expanded="true">` |
| `aria-haspopup` | Indicate popup menu | `<button aria-haspopup="true">` |
| `aria-modal` | Mark modal dialogs | `<div aria-modal="true">` |
| `aria-live` | Announce dynamic content | `<div aria-live="polite">` |
| `aria-atomic` | Announce entire region | `<div aria-atomic="true">` |
| `aria-hidden` | Hide from screen readers | `<Icon aria-hidden="true">` |
| `aria-current` | Mark current page/item | `<a aria-current="page">` |

## Roles

| Role | Usage | Example |
|------|-------|---------|
| `dialog` | Modal dialogs | `<div role="dialog">` |
| `menu` | Dropdown menus | `<div role="menu">` |
| `menuitem` | Menu items | `<button role="menuitem">` |
| `switch` | Toggle switches | `<button role="switch">` |
| `status` | Status messages | `<div role="status">` |
| `alert` | Important messages | `<div role="alert">` |
| `navigation` | Navigation sections | `<nav role="navigation">` |
| `main` | Main content | `<main role="main">` |

## Testing Commands

### Run Lighthouse Audit

```bash
# Chrome DevTools > Lighthouse > Accessibility
```

### Install axe DevTools

```bash
# Chrome Web Store: axe DevTools
```

### Check Color Contrast

```bash
# Use browser extension: WAVE or axe DevTools
```

## Common Mistakes to Avoid

❌ **Don't:**
```tsx
// Missing label
<button><X /></button>

// Div as button
<div onClick={handleClick}>Click</div>

// Missing keyboard support
<div onClick={handleClick}>Click</div>

// No focus indicator
<button className="outline-none">Click</button>

// Icon without aria-hidden
<button>Close <X /></button>
```

✅ **Do:**
```tsx
// With label
<button aria-label="Close"><X aria-hidden="true" /></button>

// Proper button
<button onClick={handleClick}>Click</button>

// Keyboard support built-in
<button onClick={handleClick}>Click</button>

// Visible focus
<button className="focus:ring-2">Click</button>

// Icon hidden from screen readers
<button aria-label="Close"><X aria-hidden="true" /></button>
```

## Checklist for New Components

- [ ] Keyboard accessible (Tab, Enter, Escape)
- [ ] ARIA labels on interactive elements
- [ ] Focus indicators visible
- [ ] Color contrast meets WCAG AA
- [ ] Touch targets minimum 44x44px
- [ ] Form labels and error messages
- [ ] Screen reader tested
- [ ] Works with high contrast mode
- [ ] Works with text scaling
- [ ] Works with reduced motion

## Resources

- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM WCAG Checklist](https://webaim.org/standards/wcag/checklist)
- [Inclusive Components](https://inclusive-components.design/)

---

Last updated: February 2026
