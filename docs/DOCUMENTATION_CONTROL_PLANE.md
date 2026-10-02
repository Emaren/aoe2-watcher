---
id: "aoe2war.aoe2-watcher.docs-documentation-control-plane"
title: "aoe2-watcher Documentation Index"
type: "generated"
status: "generated"
owner: "aoe2war-watcher"
systems: ["aoe2-watcher"]
audience: ["developers","operators","ai-agents"]
source_of_truth: "generated"
authority: "generated-repository-index"
reviewed_at: "2026-07-26"
review_interval_days: 0
sensitivity: "internal"
---

# aoe2-watcher Documentation Index

Repository ID: `aoe2-watcher`

Documentation owner: `aoe2war-watcher`

Implementation baseline: `feature/watcher-1.6.3-development` at `a806975f7c68011e3fd911d6cb9d57eb0527c263`

The implementation baseline identifies the code commit described by this documentation. Documentation-only commits may follow it without creating a self-referential registry hash.

This page is generated from the validated front matter in this repository. Cross-system architecture, governance, and the unified portal live in the sibling `AoE2WAR-docs` control-plane repository.

## Documentation health

- Authoritative repository documents: **4**
- Path moves in this migration: **0**
- Every listed document has an explicit owner, lifecycle, authority, and review interval.

### Types

- `generated`: 1
- `reference`: 1
- `working`: 2

### Lifecycle

- `active`: 3
- `generated`: 1

## Documents

| Document | Type | Status | Authority |
| --- | --- | --- | --- |
| [aoe2-watcher](../README.md) | `reference` | `active` | `repository-entrypoint` |
| [Watcher 1.6.2 Engineering Audit](WATCHER_1_6_2_AUDIT.md) | `working` | `active` | `watcher-1.6.2-engineering-plan` |
| [Watcher 1.6.3 Development](WATCHER_1_6_3_DEVELOPMENT.md) | `working` | `active` | `watcher-1.6.3-development-plan` |

## Canonical commands

```bash
python3 scripts/docs_v2_check.py
python3 scripts/docs_v2_check.py --write
python3 scripts/docs_v2_check.py --write --refresh-baseline
```

Use `--write` for documentation-only changes. Use `--refresh-baseline` only after intentional implementation changes, then review the generated index and registry before committing them.
