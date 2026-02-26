# Accessibility Documentation

## Overview

VaultDAO is committed to providing an accessible experience for all users, including those with disabilities. This document outlines the accessibility features implemented in the application and how to use them.

## WCAG 2.1 AA Compliance

The application has been designed and developed to meet WCAG 2.1 Level AA standards, ensuring:

- Perceivable: Information and UI components are presentable to users in ways they can perceive
- Operable: UI components and navigation are operable by all users
- Understandable: Information and UI operation are understandable
- Robust: Content can be interpreted by a wide variety of user agents, including assistive technologies

## Accessibility Features

### 1. Keyboard Navigation

Full keyboard navigation is supported throughout the application:

- **Tab**: Move forward through interactive elements
- **Shift + Tab**: Move backward through interactive elements
- **Enter/Space**: Activate buttons and links
- **Escape**: Close modals and dropdowns
- **Arrow keys**: Navigate within dropdown menus and lists

#### Keyboard Shortcuts

Press `?` to view all available keyboard shortcuts:

- **g + o**: Go to Overview
- **g + p**: Go to Proposals
- **g + a**: Go to Activity
- **g + s**: Go to Settings
- **w**: Connect/Disconnect Wallet

### 2. Screen Reader Support

The application is fully compatible with popular screen readers:

- **NVDA** (Windows)
- **JAWS** (Windows)
- **VoiceOver** (macOS/iOS)
- **TalkBack** (Android)

#### ARIA Implementation

- All interactive elements have appropriate ARIA labels
- Form inputs include `aria-describedby` for error messages
- Modal dialogs use `aria-modal` and `role="dialog"`
- Live regions announce dynamic content changes
- Status messages use `aria-live` for screen reader announcements

### 3. Skip Links

Skip links allow keyboard users to quickly navigate to main content areas:

- Skip to main content
- Skip to navigation
- Skip to wallet controls

These links are hidden by default and appear when focused with the keyboard.

### 4. Focus Management

- **Visible focus indicators**: All interactive elements have clear focus outlines
- **Focus trapping**: Modals trap focus within the dialog
- **Focus restoration**: Focus returns to the triggering element when modals close
- **Logical tab order**: Tab order follows visual layout

### 5. High Contrast Mode

Enable high contrast mode in Settings > Accessibility for:

- Increased contrast between text and background
- Enhanced border visibility
- Yellow focus indicators for better visibility
- Black background with white text

### 6. Text Scaling

Adjust text size from 100% to 200% in Settings > Accessibility:

- Use the slider or +/- buttons
- Text scales proportionally across the entire application
- Layout remains functional at all zoom levels
- Supports browser zoom up to 200%

### 7. Reduced Motion

Enable reduced motion in Settings > Accessibility to:

- Minimize animations and transitions
- Reduce motion-triggered effects
- Respect system preferences for reduced motion
- Improve experience for users with vestibular disorders

### 8. Touch Accessibility

Mobile-friendly design with:

- Minimum touch target size of 44x44 pixels
- Adequate spacing between interactive elements
- Touch-optimized controls and gestures
- Responsive design for all screen sizes

### 9. Form Accessibility

All forms include:

- Visible labels for all inputs
- Error messages linked to inputs via `aria-describedby`
- `aria-invalid` attribute on fields with errors
- `aria-required` for required fields
- Clear validation feedback
- Descriptive placeholder text

### 10. Color Contrast

All text and interactive elements meet WCAG AA standards:

- Normal text: 4.5:1 contrast ratio
- Large text: 3:1 contrast ratio
- UI components: 3:1 contrast ratio
- High contrast mode available for enhanced visibility

## Testing Recommendations

### Manual Testing

1. **Keyboard Navigation**
   - Navigate through all pages using only keyboard
   - Verify all interactive elements are reachable
   - Check focus indicators are visible
   - Test modal focus trapping

2. **Screen Reader Testing**
   - Test with NVDA, JAWS, or VoiceOver
   - Verify all content is announced correctly
   - Check form labels and error messages
   - Test dynamic content announcements

3. **Visual Testing**
   - Enable high contrast mode
   - Test at 200% text scale
   - Verify color contrast ratios
   - Check focus indicators visibility

4. **Mobile Testing**
   - Test touch targets (minimum 44x44px)
   - Verify responsive design
   - Test with screen reader on mobile
   - Check gesture support

### Automated Testing

The application can be tested with:

- **axe DevTools**: Browser extension for accessibility testing
- **WAVE**: Web accessibility evaluation tool
- **Lighthouse**: Chrome DevTools accessibility audit
- **Pa11y**: Command-line accessibility testing tool

To install axe-core for React testing:

```bash
npm install --save-dev @axe-core/react
```

## Browser Support

The application is tested and supported on:

- Chrome/Edge (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Known Limitations

While we strive for full accessibility, some limitations exist:

1. **Third-party Components**: Some external libraries may have accessibility limitations
2. **Complex Visualizations**: Charts and graphs include text alternatives but may not be fully accessible to screen readers
3. **IPFS Content**: User-uploaded content accessibility depends on the uploader

## Reporting Accessibility Issues

If you encounter accessibility barriers, please report them:

1. Open an issue on GitHub with the "accessibility" label
2. Include:
   - Description of the issue
   - Steps to reproduce
   - Browser and assistive technology used
   - Expected vs. actual behavior

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Resources](https://webaim.org/resources/)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)

## Continuous Improvement

Accessibility is an ongoing commitment. We regularly:

- Audit the application for accessibility issues
- Update components based on user feedback
- Stay current with WCAG guidelines
- Test with real users and assistive technologies
- Provide training for developers on accessibility best practices

## Contact

For accessibility questions or concerns, contact the development team or open an issue on GitHub.

---

Last updated: February 2026
