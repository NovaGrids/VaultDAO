# Accessibility Testing Guide

## Quick Start

### 1. Install Testing Tools
```bash
cd frontend
npm install --save-dev @axe-core/react
```

### 2. Enable axe-core in Development
Add to `src/main.tsx`:

```typescript
if (import.meta.env.DEV) {
  import('@axe-core/react').then((axe) => {
    axe.default(React, ReactDOM, 1000);
  });
}
```

## Manual Testing Procedures

### Keyboard Navigation Test
1. **Tab through all interactive elements**
   - Verify logical tab order
   - Check visible focus indicators (purple ring)
   - Ensure no keyboard traps

2. **Test keyboard shortcuts**
   - Press `Ctrl+K` to open shortcuts dialog
   - Test `Alt+1` through `Alt+6` for navigation
   - Press `Escape` to close modals

3. **Navigate without mouse**
   - Complete a full user flow using only keyboard
   - Create a proposal
   - Approve/reject a proposal
   - Navigate all pages

### Screen Reader Testing

#### NVDA (Windows - Free)
1. Download from [nvaccess.org](https://www.nvaccess.org/)
2. Start NVDA (`Ctrl+Alt+N`)
3. Navigate with:
   - `H` - Next heading
   - `Tab` - Next interactive element
   - `Enter` - Activate element
   - `Insert+Down Arrow` - Read all

#### VoiceOver (macOS - Built-in)
1. Enable: `Cmd+F5`
2. Navigate with:
   - `VO+Right Arrow` - Next item
   - `VO+Space` - Activate
   - `VO+A` - Read all
   - `VO+U` - Rotor menu

#### Testing Checklist
- [ ] All headings are announced correctly
- [ ] Navigation landmarks are identified
- [ ] Button labels are descriptive
- [ ] Form labels are associated with inputs
- [ ] Error messages are announced
- [ ] Status changes are announced
- [ ] Modal dialogs are announced
- [ ] Skip links work correctly

### Visual Testing

#### High Contrast Mode
1. Go to Settings → Accessibility
2. Enable "High Contrast Mode"
3. Verify:
   - [ ] All text is readable
   - [ ] Focus indicators are visible (yellow)
   - [ ] Borders are clear
   - [ ] No information lost

#### Text Scaling
1. Go to Settings → Accessibility
2. Increase text size to 200%
3. Verify:
   - [ ] No text overlap
   - [ ] No horizontal scrolling
   - [ ] All content accessible
   - [ ] Layout remains functional

#### Color Blindness Simulation
Use browser extensions:
- Chrome: "Colorblindly"
- Firefox: "Colorblind - Dalton"

Test with:
- [ ] Protanopia (red-blind)
- [ ] Deuteranopia (green-blind)
- [ ] Tritanopia (blue-blind)

Verify status indicators work without color.

### Touch Target Testing (Mobile)

#### Tools
- Chrome DevTools Device Mode
- Physical mobile device

#### Checklist
- [ ] All buttons minimum 44x44px
- [ ] Adequate spacing between targets
- [ ] No accidental activations
- [ ] Swipe gestures have alternatives

### Focus Management Testing

#### Modal Dialogs
1. Open any modal (e.g., New Proposal)
2. Verify:
   - [ ] Focus moves to modal
   - [ ] Tab cycles within modal only
   - [ ] Escape closes modal
   - [ ] Focus returns to trigger button

#### Navigation
1. Click navigation item
2. Verify:
   - [ ] Focus moves to main content
   - [ ] Skip links work
   - [ ] Back button maintains focus

## Automated Testing

### Browser Extensions

#### axe DevTools (Free)
1. Install from Chrome Web Store
2. Open DevTools → axe DevTools tab
3. Click "Scan ALL of my page"
4. Review and fix issues

#### WAVE (Free)
1. Install from [wave.webaim.org](https://wave.webaim.org/extension/)
2. Click WAVE icon
3. Review errors and alerts

#### Lighthouse (Built-in Chrome)
1. Open DevTools → Lighthouse tab
2. Select "Accessibility" category
3. Click "Generate report"
4. Target: 95+ score

### Command Line Testing

#### Pa11y
```bash
npm install -g pa11y
pa11y http://localhost:5173
```

#### axe-cli
```bash
npm install -g @axe-core/cli
axe http://localhost:5173
```

## Component-Specific Tests

### Forms
- [ ] All inputs have labels
- [ ] Required fields marked
- [ ] Error messages associated with inputs
- [ ] Validation errors announced
- [ ] Success messages announced

### Tables/Lists
- [ ] Proper table headers
- [ ] Row/column associations
- [ ] List semantics correct
- [ ] Sortable columns keyboard accessible

### Charts
- [ ] Alternative text descriptions
- [ ] Data tables provided
- [ ] Keyboard navigation
- [ ] Screen reader announcements

### Modals
- [ ] Focus trap works
- [ ] Escape closes modal
- [ ] Focus restoration
- [ ] Backdrop click closes
- [ ] Proper ARIA attributes

## Common Issues & Fixes

### Issue: Missing ARIA Labels
```tsx
// ❌ Bad
<button onClick={handleClick}>
  <Icon />
</button>

// ✅ Good
<button onClick={handleClick} aria-label="Delete proposal">
  <Icon aria-hidden="true" />
</button>
```

### Issue: No Focus Indicator
```css
/* ❌ Bad */
button:focus {
  outline: none;
}

/* ✅ Good */
button:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
}
```

### Issue: Color-Only Information
```tsx
// ❌ Bad
<span className="text-red-500">Error</span>

// ✅ Good
<span className="text-red-500">
  <AlertCircle aria-hidden="true" />
  <span>Error</span>
</span>
```

### Issue: Keyboard Trap
```tsx
// ❌ Bad - No escape
<div onKeyDown={(e) => e.preventDefault()}>

// ✅ Good - Allow escape
<div onKeyDown={(e) => {
  if (e.key === 'Escape') onClose();
}}>
```

## Testing Schedule

### During Development
- Run axe DevTools on every component
- Test keyboard navigation for new features
- Verify ARIA labels on interactive elements

### Before PR
- Full keyboard navigation test
- Screen reader spot check
- Lighthouse accessibility audit (95+ score)

### Before Release
- Complete manual testing checklist
- Screen reader full flow test
- Mobile touch target verification
- High contrast mode verification
- Text scaling to 200% test

## Reporting Issues

### Issue Template
```markdown
**Component**: [Component name]
**WCAG Criterion**: [e.g., 2.4.7 Focus Visible]
**Severity**: [Critical/High/Medium/Low]
**Description**: [What's wrong]
**Steps to Reproduce**:
1. 
2. 
3. 

**Expected**: [What should happen]
**Actual**: [What actually happens]
**Screen Reader**: [NVDA/JAWS/VoiceOver/etc.]
**Browser**: [Chrome/Firefox/Safari]
```

## Resources

### Tools
- [axe DevTools](https://www.deque.com/axe/devtools/)
- [WAVE](https://wave.webaim.org/)
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [NVDA Screen Reader](https://www.nvaccess.org/)
- [Pa11y](https://pa11y.org/)

### Documentation
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Articles](https://webaim.org/articles/)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)

### Training
- [Web Accessibility by Google (Udacity)](https://www.udacity.com/course/web-accessibility--ud891)
- [Deque University](https://dequeuniversity.com/)
- [WebAIM Training](https://webaim.org/training/)
