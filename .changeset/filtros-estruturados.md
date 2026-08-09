---
'@bull-horizon/ui': minor
---

Job search gains a visual filter builder, now the default mode, toggled with the `<>` button next to the search field. A new preference — *Start job search in visual filter mode* — switches the starting mode back to the raw jsonata expression for anyone who prefers typing. Rows (`field | operator | value`) combine with AND/OR and support nested groups, covering `=`, `≠`, `>`, `≥`, `<`, `≤` and `contains`. The field input autocompletes from the jobs already loaded, so it only suggests paths that actually exist in the payload.

The jsonata expression remains the single source of truth — the visual mode is a projection of it, and both directions are preserved: nested paths, wildcards (`data.*.to`, `data.**.email`) and backtick-escaped keys (``data.`weird*key```) survive the round trip untouched. When an expression uses anything outside that grammar (array predicates, functions other than `contains`), the toggle is disabled and the search stays in text mode rather than rewriting the query.

The **Return Value** pane now supports click-to-filter, like Job Data: an object return builds `returnvalue.status = "ok"`, while a plain-text return builds `returnvalue = "done"`.

The search hint no longer links to a deleted document (it 404'd); it now names the job fields the search can reach and points at the new visual mode. Demo mock payloads were rewritten to be nested and varied, so the demo actually exercises nested paths, wildcards and backtick-escaped keys.
