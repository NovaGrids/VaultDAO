# Advanced Dashboard Visualization

## Overview

The Advanced Dashboard feature provides a fully customizable, interactive data visualization system with drag-and-drop layout management, multiple chart types, and mobile-responsive design.

## Features

### Widget Types

1. **Line Chart** - Trend analysis over time
2. **Bar Chart** - Compare values across categories
3. **Pie Chart** - Distribution visualization
4. **Stat Card** - Display key metrics
5. **Proposal List** - Recent proposals with status
6. **Calendar** - Events and deadlines

### Capabilities

- **Drag-and-Drop Layout**: Rearrange widgets by dragging (desktop) or touch gestures (mobile)
- **Resizable Widgets**: Adjust widget size to fit your needs
- **Dashboard Templates**: Pre-configured layouts for Executive, Treasurer, and Admin roles
- **Save/Load Layouts**: Persist your custom dashboard configuration
- **Data Drill-Down**: Click on charts to view detailed data
- **Export**: Download dashboard as PNG or PDF
- **Mobile Responsive**: Touch-optimized for tablets and phones

## Usage

### Accessing the Dashboard

1. Navigate to the Overview page
2. Click "Advanced Dashboard" button in the header
3. Toggle between Classic and Advanced views

### Edit Mode

1. Click "Edit" button to enter edit mode
2. Add widgets from the Widget Library
3. Drag widgets to reposition
4. Resize widgets by dragging corners
5. Remove widgets with the X button
6. Click "Save" to persist changes

### Templates

1. Click "Templates" in edit mode
2. Choose from Executive, Treasurer, or Admin templates
3. Template loads pre-configured widgets and layout

### Export

1. Click "PNG" or "PDF" button in toolbar
2. Dashboard captures current view
3. File downloads automatically

## Mobile Support

- **Touch Gestures**: Long-press and drag to move widgets
- **Responsive Grid**: Automatically adjusts columns for screen size
- **Swipe**: Navigate between widgets on small screens

## Technical Details

### Storage

- Layouts saved to `localStorage` under key `vaultdao-dashboard-layout`
- Persists across sessions
- Can be cleared by browser cache management

### Dependencies

- `react-grid-layout`: Drag-and-drop grid system
- `recharts`: Chart rendering
- `html2canvas`: Screenshot capture
- `jspdf`: PDF generation

### File Structure

```
frontend/src/
├── components/
│   ├── DashboardBuilder.tsx       # Main dashboard component
│   ├── WidgetLibrary.tsx          # Widget selection panel
│   └── widgets/
│       ├── LineChartWidget.tsx
│       ├── BarChartWidget.tsx
│       ├── PieChartWidget.tsx
│       ├── StatCardWidget.tsx
│       ├── ProposalListWidget.tsx
│       └── CalendarWidget.tsx
├── types/
│   └── dashboard.ts               # TypeScript types
└── utils/
    └── dashboardTemplates.ts      # Templates and storage
```

## Customization

### Adding New Widget Types

1. Create widget component in `components/widgets/`
2. Add type to `types/dashboard.ts`
3. Register in `WidgetLibrary.tsx`
4. Add render case in `DashboardBuilder.tsx`

### Creating Templates

Edit `utils/dashboardTemplates.ts`:

```typescript
{
  id: 'custom',
  name: 'Custom Dashboard',
  description: 'Your custom layout',
  role: 'Custom',
  layout: {
    widgets: [...],
    layout: [...]
  }
}
```

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Touch gestures supported

## Performance

- Lazy rendering for off-screen widgets
- Optimized grid calculations
- Debounced layout updates
- Efficient re-renders with React.memo

## Troubleshooting

**Widgets not dragging**: Ensure edit mode is enabled

**Layout not saving**: Check browser localStorage permissions

**Export not working**: Verify html2canvas and jspdf are installed

**Mobile gestures not working**: Ensure touch events are not blocked by other handlers
