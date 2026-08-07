import { JobStatus } from '@/typings/gql';

// Job-status semantics are intentionally separate from the brand accent
// (see memorys/architecture.md / theme.ts `horizon` palette) — these read as
// signal colors on an instrument panel, not as extensions of the amber
// brand mark.
const palette: Record<JobStatus, string> = {
  [JobStatus.Failed]: '#e5484d',
  [JobStatus.Completed]: '#3dd68c',
  [JobStatus.Delayed]: '#4c9fe8',
  [JobStatus.Waiting]: '#8d82e6',
  [JobStatus.Active]: '#33c2c9',
  [JobStatus.Prioritized]: '#ec4899',
  [JobStatus.Paused]: '#83795f',
  [JobStatus.Stuck]: '#a79c86',
  [JobStatus.Unknown]: '#6b6353',
};
export const useJobStatusesPalette = () => palette;
export const useJobStatusColor = (status: JobStatus): string => {
  return palette[status];
};
