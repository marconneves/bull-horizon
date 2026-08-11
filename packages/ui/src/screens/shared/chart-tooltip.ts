import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

/**
 * Recharts' tooltip defaults to a white box with dark text, which is wrong in
 * both of this dashboard's themes (and was previously patched with a hardcoded
 * `color: 'black'` on the label). These props pull every surface off the MUI
 * theme so it follows the dark "horizon" palette, the light theme and the
 * selectable accents without any per-chart overrides.
 */
export const chartTooltipProps = (theme: Theme) => ({
  contentStyle: {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    boxShadow: theme.shadows[3],
    fontSize: 13,
    padding: '8px 10px',
  },
  labelStyle: {
    color: theme.palette.text.secondary,
    fontSize: 11,
    marginBottom: 4,
  },
  itemStyle: {
    // Recharts colors each item by its series stroke; only the padding needs
    // resetting so the rows sit tight inside the themed box.
    padding: '1px 0',
  },
  // The hover guide line has to read against the surface, not against white.
  cursor: { stroke: alpha(theme.palette.text.primary, 0.25), strokeWidth: 1 },
});
