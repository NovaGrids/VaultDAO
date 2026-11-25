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

## Incident War Room

The Incident War Room is a focused operational view (Issue #2066) for the
minutes after a circuit breaker trips or a vault pause is detected. Open it
from the sidebar or directly at `/dashboard/incident-war-room`.

### What it shows

- **Overall status** — `NORMAL`, `TRIPPED` or `PAUSED`. A vault pause outranks a
  tripped breaker, which outranks normal operation.
- **Pause banner** — when the vault is paused, the cause, timestamp and actor
  from the latest `vault_paused` state are displayed.
- **Per-token outflow vs circuit-breaker limit** — a semantic table with token,
  observed outflow, token limit, a utilisation meter, breaker state and a link
  to the recovery proposal. Amounts are base-unit strings, so stroop/i128
  precision is preserved; only the meter converts them to a number.
- **Pending reservations** — approved-but-unexecuted proposals still holding
  funds, with their token, reserved amount, creation time and recovery link.

Recovery links are same-app deep links of the form
`/dashboard/proposals?search=<proposalId>`. Only numeric proposal ids are
linked, so a hostile payload cannot turn a link into an external or
`javascript:` URL. All token symbols, addresses, causes and memos are rendered
as React text; the view never uses `dangerouslySetInnerHTML`.

### Data and realtime

The initial snapshot is loaded over the existing GraphQL transport when
`VITE_GRAPHQL_URL` is set (otherwise `VITE_API_BASE_URL/graphql` is used). The
expected query is `IncidentWarRoom($contractId: String!)` returning an
`incidentWarRoom` object with `pause`, `tokens` and `reservations`; the
normalizer also accepts `vault`/`incident` aliases and flexible field names.

Live changes arrive through `RealtimeContext` (the shared WebSocket), using
the contract event names `vault_paused`, `vault_unpaused`,
`token_breaker_tripped`, `token_breaker_reset`, `reservation_created` and
`reservation_released`. Subscriptions are registered in an effect and every
unsubscribe function is called on cleanup. If no `RealtimeProvider` is mounted,
the socket is disconnected, or the GraphQL endpoint is unreachable, the view
keeps the last known snapshot and reports "Live updates unavailable" instead
of throwing.

### Acknowledge and export

- **Acknowledge** is a keyboard-accessible button. It emits
  `incident_acknowledged` over the WebSocket (when available), calls the
  optional `onAcknowledge` callback and disables itself for the current
  incident/status. It is an operator acknowledgement only; it does not reset a
  breaker or unpause the vault.
- **Export CSV** serialises both tables with the shared
  `frontend/src/utils/csv.ts` helpers. `neutralizeFormula` prefixes values
  beginning with `=`, `+`, `-`, `@`, tab or carriage return with a single quote,
  so spreadsheet formulas supplied in a token symbol or memo cannot execute.

### Accessibility

- Token and reservation data use real `<table>`/`<th scope>` markup with
  captions, and every action is a native `<button>` or `<a>`.
- Status, connection and acknowledgement messages are exposed through a
  visible `role="status"` / `aria-live="polite"` region.
- All interactive controls have visible focus rings and at least 44px touch
  targets; state colours pair light text with dark backgrounds for contrast.

### Code and tests

```
frontend/src/types/incident.ts                       # View-model types
frontend/src/utils/incidentWarRoom.ts                # CSV, status, event merge, GraphQL
frontend/src/hooks/useIncidentWarRoom.ts             # WebSocket + GraphQL subscription hook
frontend/src/components/IncidentWarRoom.tsx          # View
frontend/src/components/__tests__/IncidentWarRoom.test.tsx
frontend/src/utils/__tests__/incidentWarRoom.test.ts
```

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
│   ├── IncidentWarRoom.tsx        # Incident war-room view
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
