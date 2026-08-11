---
'@bull-horizon/ui': minor
---

add Overview and Metrics history screens, remove the per-queue metrics screen

Two new screens: **Overview**, a grid of every queue's status breakdown as a
stacked bar, grouped into sections by `Queue.group` and filterable by status;
and **Metrics history**, the throughput of all queues aggregated, with a
per-queue table showing runs, completions and failure rate. Clicking a card or a
table row opens that queue's job list on the status you were looking at. A
collapsible throughput chart also sits above each queue's job list — collapsed,
it stops polling.

Charts plot a **rate per minute** rather than a raw counter. Points come from
whichever retention tier covers the selected window, so a 12-hour bucket and a
one-minute bucket both arrive as "a point"; charting their raw counts would make
the older end of the series tower over the recent end and silently change what
the Y axis means as you switch ranges. The failure share sits next to the total
instead of on a second axis, which would have made the failure line's shape
readable at the cost of making its magnitude incomparable.

The range selector offers exactly the windows the server says it can answer for
(`Query.metricsInfo`), rather than a hardcoded list.

**Removed: the per-queue metrics screen.** Its `Clear` / `Clear all` buttons moved
to Metrics history — they were the only UI for the `clearMetrics` /
`clearAllMetrics` mutations. The data is untouched: `Query.metrics` still returns
per-status counts and processing time, and the Prometheus endpoint still exports
duration. A persisted `screen: 'metrics'` in localStorage now falls back to the
job list instead of rendering blank.

Navigation moved out of the AppBar toggle into the sidebar, with `Jobs` listed
explicitly so returning to it is always one click.

Also in this release:

- The chart tooltip follows the theme. Recharts renders a white box with dark
  text by default, which was wrong in both themes and had been papered over with
  a hardcoded black label color.
- Job Data / Return Value / Stacktrace panels gained **expand all** and **copy**
  buttons. Copy re-serializes so the clipboard gets formatted JSON rather than
  the single-line blob the API returns, and falls back to `execCommand` because
  `navigator.clipboard` does not exist over plain http — which is how the
  dashboard is usually reached on a LAN.
- The queue list stops polling while the browser tab is in the background, and
  keeps its previous data instead of blanking into a loading state on every
  refetch.
- Picking a queue from the sidebar while an all-queue screen was open changed the
  selection but left the screen looking identical. It now opens that queue's job
  list.
