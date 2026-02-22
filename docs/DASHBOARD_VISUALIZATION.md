# Advanced Dashboard Visualization

## Overview
Interactive data visualization dashboard with customizable widgets, drag-and-drop layout, multiple chart types, and data drill-down capabilities. Fully mobile responsive with touch gestures.

## Features

### Widget Types
1. **Line Chart** - Trend visualization with multiple series
2. **Bar Chart** - Comparative data display
3. **Pie Chart** - Distribution and proportion visualization
4. **Stat Card** - Key metrics display with icons
5. **Proposal List** - Recent proposals overview
6. **Calendar** - Upcoming events timeline

### Dashboard Templates
- **Executive Dashboard** - High-level overview for executives
- **Treasurer Dashboard** - Financial tracking and proposal management
- **Admin Dashboard** - Complete system overview

### Capabilities
- ✅ Drag-and-drop widget layout
- ✅ Resize widgets
- ✅ Add/remove widgets
- ✅ Save/load custom layouts
- ✅ Pre-built templates for different roles
- ✅ Export dashboard as PDF
- ✅ Mobile responsive with touch gestures
- ✅ Data drill-down on chart click

## Usage

### Edit Mode
1. Click "Edit" button to enter edit mode
2. Drag widgets to rearrange
3. Resize widgets by dragging corners
4. Click "Add Widget" to open widget library
5. Click "Save" to persist layout

### Templates
1. Click "Templates" button
2. Select a pre-built template
3. Customize as needed
4. Save your custom layout

### Export
Click "Export" button to download dashboard as PDF

## Mobile Support
- Touch and drag to rearrange widgets
- Pinch to resize (on supported devices)
- Swipe gestures for navigation
- Responsive breakpoints for all screen sizes

## Technical Details

### Dependencies
- `react-grid-layout` - Drag-and-drop grid system
- `react-to-print` - PDF export functionality
- `recharts` - Chart rendering

### Storage
Layouts are saved to localStorage with key `dashboard-layout`

### File Structure
```
frontend/src/
├── components/
│   ├── DashboardBuilder.tsx       # Main dashboard component
│   ├── WidgetLibrary.tsx          # Widget selection panel
│   └── widgets/
│       ├── ChartWidget.tsx        # Chart widgets (line, bar, pie)
│       ├── StatCardWidget.tsx     # Stat card widget
│       ├── ProposalListWidget.tsx # Proposal list widget
│       └── CalendarWidget.tsx     # Calendar widget
├── types/
│   └── dashboard.ts               # TypeScript types
├── utils/
│   └── dashboardTemplates.ts      # Pre-built templates
└── app/dashboard/
    └── Overview.tsx               # Updated overview page
```

## Customization

### Adding New Widget Types
1. Create widget component in `widgets/` folder
2. Add type to `dashboard.ts`
3. Add to `WidgetLibrary.tsx`
4. Add render case in `DashboardBuilder.tsx`

### Creating Templates
Add new template to `dashboardTemplates.ts`:
```typescript
{
  id: 'custom',
  name: 'Custom Template',
  description: 'Description',
  role: 'role',
  layout: {
    id: 'custom-layout',
    name: 'Custom',
    widgets: [...],
    layout: [...]
  }
}
```

## Browser Support
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)
