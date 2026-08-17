---
schema_version: 1
open_count: 0
waived_count: 1
fixed_count: 0
total_count: 1
last_updated: 2026-08-17T13:55:57.310Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | unrun-verify | README.md |  | README code examples validated against real signatures but not executed against a live RouterOS device (no hardware in scope) | waived | Not a skipped plan verify — docs-only plan; live RouterOS execution is out of scope for phase 05 | 2026-08-17T13:55:15.377Z | 2026-08-17T13:55:57.310Z |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "README.md",
    "line": null,
    "description": "README code examples validated against real signatures but not executed against a live RouterOS device (no hardware in scope)",
    "status": "waived",
    "reason": "Not a skipped plan verify — docs-only plan; live RouterOS execution is out of scope for phase 05",
    "recorded_at": "2026-08-17T13:55:15.377Z",
    "resolved_at": "2026-08-17T13:55:57.310Z"
  }
]
````
