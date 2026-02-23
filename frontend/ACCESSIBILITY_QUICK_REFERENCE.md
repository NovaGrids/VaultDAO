# Accessibility Quick Reference

## Common Patterns

### Button with Icon Only
```tsx
<button
  onClick={handleClick}
  aria-label="Delete proposal"
  className="..."
>
  <TrashIcon aria-hidden="true" />
</button>
```

### Button with Icon and Text
```tsx
<button
  onClick={handleClick}
  aria-label="Delete proposal #123"
  className="..."
>
  <TrashIcon aria-hidden="true" />
  <span>Delete</span>
</button>
```

### Link with Icon
```tsx
<Link
  to="/proposals"
  aria-label="View all proposals"
  className="..."
>
  <FileTextIcon aria-hidden="true" />
  <span>Proposals</span>
</Link>
```

### Active Navigation Item
```tsx
<Link
  to="/dashboard"
  aria-current={isActive ? 'page' : undefined}
  className={isActive ? 'active' : ''}
>
  Dashboard
</Link>
```

### Modal Dialog
```tsx
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

const Modal = ({ isOpen, onClose, title, children }) => {
  const containerRef = useFocusTrap(isOpen);
  
  useKeyboardNavigation({
    onEscape: onClose,
    enabled: isOpen,
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
    >
      <div ref={containerRef} className="bg-gray-800 rounded-xl p-6">
        <h2 id="modal-title">{title}</h2>
        <div id="modal-description">{children}</div>
        <button onClick={onClose} aria-label="Close dialog">
          Close
        </button>
      </div>
    </div>
  );
};
```

### Form Input with Label
```tsx
<div>
  <label htmlFor="email" className="block mb-2">
    Email Address
  </label>
  <input
    id="email"
    type="email"
    aria-required="true"
    aria-invalid={hasError}
    aria-describedby={hasError ? 'email-error' : undefined}
    className="..."
  />
  {hasError && (
    <p id="email-error" className="text-red-400 text-sm mt-1" role="alert">
      Please enter a valid email address
    </p>
  )}
</div>
```

### Toggle Switch
```tsx
<button
  onClick={toggle}
  role="switch"
  aria-checked={isEnabled}
  aria-label="Enable notifications"
  className={`relative inline-flex h-6 w-11 items-center rounded-full ${
    isEnabled ? 'bg-purple-600' : 'bg-gray-600'
  }`}
>
  <span
    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
      isEnabled ? 'translate-x-6' : 'translate-x-1'
    }`}
  />
</button>
```

### Status Badge
```tsx
<span
  role="status"
  aria-label={`Status: ${status}`}
  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full"
>
  <CheckCircle size={12} aria-hidden="true" />
  <span>{status}</span>
</span>
```

### Loading State
```tsx
<button
  disabled={isLoading}
  aria-busy={isLoading}
  aria-label={isLoading ? 'Loading...' : 'Submit'}
  className="..."
>
  {isLoading ? (
    <>
      <Loader className="animate-spin" aria-hidden="true" />
      <span>Loading...</span>
    </>
  ) : (
    'Submit'
  )}
</button>
```

### Toast Notification
```tsx
<div
  role="alert"
  aria-live="polite"
  aria-atomic="true"
  className="..."
>
  <CheckCircle aria-hidden="true" />
  <span>{message}</span>
  <button onClick={onClose} aria-label="Dismiss notification">
    <X aria-hidden="true" />
  </button>
</div>
```

### Dropdown Menu
```tsx
<div className="relative">
  <button
    onClick={toggleMenu}
    aria-expanded={isOpen}
    aria-haspopup="true"
    aria-label="Open user menu"
    className="..."
  >
    Menu
  </button>
  {isOpen && (
    <div role="menu" aria-label="User options" className="...">
      <button role="menuitem" onClick={handleProfile}>
        Profile
      </button>
      <button role="menuitem" onClick={handleSettings}>
        Settings
      </button>
      <button role="menuitem" onClick={handleLogout}>
        Logout
      </button>
    </div>
  )}
</div>
```

### Card with Click Action
```tsx
<article
  tabIndex={0}
  role="button"
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }}
  aria-label={`Proposal ${id}: ${amount} to ${recipient}`}
  className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500"
>
  {/* Card content */}
</article>
```

### Skip Links
```tsx
<div className="skip-links">
  <a href="#main-content" className="skip-link">
    Skip to main content
  </a>
  <a href="#navigation" className="skip-link">
    Skip to navigation
  </a>
</div>

{/* CSS */}
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
}
```

### Screen Reader Only Text
```tsx
<span className="sr-only">
  This text is only visible to screen readers
</span>

{/* CSS */}
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

### Accessible Table
```tsx
<table role="table" aria-label="Proposals list">
  <thead>
    <tr>
      <th scope="col">ID</th>
      <th scope="col">Amount</th>
      <th scope="col">Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td>1000 XLM</td>
      <td>
        <StatusBadge status="Approved" />
      </td>
    </tr>
  </tbody>
</table>
```

## Hooks Usage

### useFocusTrap
```tsx
import { useFocusTrap } from '../hooks/useFocusTrap';

const Modal = ({ isOpen }) => {
  const containerRef = useFocusTrap(isOpen);
  
  return (
    <div ref={containerRef}>
      {/* Modal content */}
    </div>
  );
};
```

### useKeyboardNavigation
```tsx
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

const Component = () => {
  useKeyboardNavigation({
    onEscape: () => console.log('Escape pressed'),
    onEnter: () => console.log('Enter pressed'),
    onArrowUp: () => console.log('Arrow up pressed'),
    onArrowDown: () => console.log('Arrow down pressed'),
    enabled: true,
  });
  
  return <div>Content</div>;
};
```

### useAccessibility
```tsx
import { useAccessibility } from '../context/AccessibilityContext';

const Component = () => {
  const {
    settings,
    toggleHighContrast,
    setTextScale,
    toggleReducedMotion,
    announceToScreenReader,
  } = useAccessibility();
  
  const handleAction = () => {
    // Perform action
    announceToScreenReader('Action completed successfully');
  };
  
  return (
    <div>
      <button onClick={toggleHighContrast}>
        Toggle High Contrast
      </button>
      <button onClick={() => setTextScale(1.5)}>
        Set Text Scale to 150%
      </button>
    </div>
  );
};
```

## ARIA Attributes Reference

### Common ARIA Attributes
- `aria-label` - Provides accessible name
- `aria-labelledby` - References element that labels this one
- `aria-describedby` - References element that describes this one
- `aria-hidden` - Hides element from screen readers
- `aria-live` - Announces dynamic content changes
- `aria-current` - Indicates current item in navigation
- `aria-expanded` - Indicates if element is expanded
- `aria-haspopup` - Indicates element has popup
- `aria-controls` - References element controlled by this one
- `aria-required` - Indicates required form field
- `aria-invalid` - Indicates invalid form field
- `aria-busy` - Indicates loading state
- `aria-checked` - Indicates checkbox/switch state
- `aria-selected` - Indicates selected state
- `aria-disabled` - Indicates disabled state

### ARIA Roles
- `role="button"` - Interactive button
- `role="dialog"` - Modal dialog
- `role="menu"` - Menu container
- `role="menuitem"` - Menu item
- `role="navigation"` - Navigation region
- `role="main"` - Main content
- `role="banner"` - Header/banner
- `role="status"` - Status message
- `role="alert"` - Important message
- `role="switch"` - Toggle switch
- `role="tab"` - Tab in tab list
- `role="tabpanel"` - Tab panel content

### ARIA Live Regions
- `aria-live="polite"` - Announces when user is idle
- `aria-live="assertive"` - Announces immediately
- `aria-atomic="true"` - Announces entire region
- `aria-relevant="additions text"` - What changes to announce

## Focus Management

### Focus Visible Styles
```css
/* Global focus styles */
*:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}

/* Button focus */
button:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}

/* High contrast focus */
.high-contrast *:focus-visible {
  outline: 3px solid #ffff00;
  outline-offset: 3px;
}
```

### Programmatic Focus
```tsx
// Focus element
const buttonRef = useRef<HTMLButtonElement>(null);
buttonRef.current?.focus();

// Focus first input in form
const firstInput = formRef.current?.querySelector('input');
firstInput?.focus();

// Focus element after delay
setTimeout(() => {
  elementRef.current?.focus();
}, 100);
```

## Testing Commands

### Keyboard Testing
- `Tab` - Next focusable element
- `Shift+Tab` - Previous focusable element
- `Enter` - Activate button/link
- `Space` - Activate button/checkbox
- `Escape` - Close modal/menu
- `Arrow keys` - Navigate lists/menus

### Screen Reader Commands (NVDA)
- `Insert+Down Arrow` - Read all
- `H` - Next heading
- `Tab` - Next interactive element
- `B` - Next button
- `F` - Next form field
- `L` - Next list
- `Insert+F7` - List all elements

### Screen Reader Commands (VoiceOver)
- `VO+A` - Read all
- `VO+Right Arrow` - Next item
- `VO+Space` - Activate
- `VO+U` - Rotor menu
- `VO+H` - Next heading

## Common Mistakes to Avoid

### ❌ Don't
```tsx
// Missing label
<button onClick={handleClick}>
  <Icon />
</button>

// Color-only information
<span className="text-red-500">Error</span>

// Keyboard trap
<div onKeyDown={(e) => e.preventDefault()}>

// No focus indicator
button:focus { outline: none; }

// Div as button
<div onClick={handleClick}>Click me</div>

// Missing alt text
<img src="logo.png" />
```

### ✅ Do
```tsx
// With label
<button onClick={handleClick} aria-label="Delete">
  <Icon aria-hidden="true" />
</button>

// Icon + text
<span className="text-red-500">
  <AlertIcon aria-hidden="true" />
  Error
</span>

// Allow escape
<div onKeyDown={(e) => {
  if (e.key === 'Escape') onClose();
}}>

// Visible focus
button:focus-visible {
  outline: 2px solid #a78bfa;
}

// Semantic button
<button onClick={handleClick}>Click me</button>

// With alt text
<img src="logo.png" alt="VaultDAO logo" />
```

## Resources

- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Articles](https://webaim.org/articles/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)

---

**Keep this reference handy when developing new features!**
