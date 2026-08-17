---
schema_version: 1
open_count: 1
waived_count: 1
fixed_count: 0
total_count: 2
last_updated: 2026-08-17T21:34:20.492Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | unrun-verify | README.md |  | README code examples validated against real signatures but not executed against a live RouterOS device (no hardware in scope) | waived | Not a skipped plan verify — docs-only plan; live RouterOS execution is out of scope for phase 05 | 2026-08-17T13:55:15.377Z | 2026-08-17T13:55:57.310Z |
| 2 | 07 | stub | test/integration/recipes/v6.ts |  | v6 User Manager link/router are v7-only (no user-profile link table; router is the v7 NAS client) — linkAdd/linkRead/linkDel/routerAdd/routerRead/routerDel are throwing stubs; suite skips link/router on v6 by version | open |  | 2026-08-17T21:34:20.492Z |  |

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
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "07",
    "file": "test/integration/recipes/v6.ts",
    "line": null,
    "description": "v6 User Manager link/router are v7-only (no user-profile link table; router is the v7 NAS client) — linkAdd/linkRead/linkDel/routerAdd/routerRead/routerDel are throwing stubs; suite skips link/router on v6 by version",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-17T21:34:20.492Z",
    "resolved_at": null
  }
]
````
