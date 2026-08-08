import { alpha } from '@mui/material/styles';

// Shared tint math so JobStatusChip and the Filters status pills render
// pixel-identical colors for the same status instead of drifting apart.
// `backgroundOpacity` is exposed so an "active" filter pill can reuse the
// same border/text formula with a stronger fill.
export const getStatusPillColors = (
  color: string,
  backgroundOpacity = 0.14
) => ({
  background: alpha(color, backgroundOpacity),
  border: alpha(color, 0.32),
  text: color,
});
