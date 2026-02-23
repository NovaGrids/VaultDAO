# Quick Start: Advanced Dashboard

## Installation

```bash
# Switch to feature branch
git checkout feature/advanced-visualization

# Install dependencies
cd frontend
npm install

# Start development server
npm run dev
```

## Usage

### 1. Access the Dashboard
- Open http://localhost:5173
- Navigate to Dashboard → Overview
- Click **"Advanced Dashboard"** button in header

### 2. Add Widgets
1. Click **"Edit"** button
2. Click **"Add Widget"**
3. Select widget type from library
4. Widget appears in grid
5. Click **"Save"** to persist

### 3. Use Templates
1. Click **"Edit"** button
2. Click **"Templates"**
3. Choose:
   - **Executive**: Overview with key metrics
   - **Treasurer**: Financial tracking
   - **Admin**: Governance focus
4. Template loads instantly

### 4. Export Dashboard
- Click **"PNG"** for image export
- Click **"PDF"** for PDF report
- File downloads automatically

### 5. View Details
- Click any chart
- Modal shows detailed data
- Click X to close

## Widget Types

| Widget | Purpose | Best For |
|--------|---------|----------|
| Line Chart | Trends over time | Treasury growth, cash flow |
| Bar Chart | Category comparison | Spending by category, activity |
| Pie Chart | Distribution | Budget allocation, portfolio |
| Stat Card | Key metrics | Balance, proposals, members |
| Proposal List | Recent items | Active proposals, pending votes |
| Calendar | Events | Payment schedules, deadlines |

## Mobile Usage

- **Portrait**: 1 column layout
- **Tablet**: 2 column layout
- **Desktop**: 3 column layout
- **Touch**: All controls are 44px+ for easy tapping

## Keyboard Shortcuts

- `Ctrl/Cmd + S`: Save dashboard (in edit mode)
- `Escape`: Exit edit mode
- `Escape`: Close drill-down modal

## Tips

1. **Start with a Template**: Choose a template matching your role, then customize
2. **Mix Widget Types**: Combine charts and stats for comprehensive view
3. **Export Regularly**: Save PNG/PDF snapshots for reports
4. **Mobile First**: Test on mobile to ensure readability

## Troubleshooting

**Widgets not appearing?**
- Check browser console for errors
- Ensure you clicked "Save" after adding widgets

**Layout not saving?**
- Check browser localStorage is enabled
- Try clearing cache and reloading

**Export not working?**
- Ensure pop-ups are not blocked
- Check browser download permissions

**Mobile layout broken?**
- Clear browser cache
- Ensure viewport meta tag is present

## Support

- **Documentation**: `docs/ADVANCED_DASHBOARD.md`
- **Issues**: Create GitHub issue with `dashboard` label
- **Questions**: Ask in project Discord/Slack

## Next Steps

1. Explore all widget types
2. Create custom dashboard layout
3. Export and share with team
4. Provide feedback for improvements

---

**Happy Dashboarding! 📊**
