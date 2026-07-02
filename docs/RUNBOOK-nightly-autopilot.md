# RUNBOOK — nightly-autopilot (Promptbox)

Overnight roadmap-to-PR runner (ADR-0022). The run implements pending `[ ]` features from `PROJECT.md`, one concept-to-code chain each, and leaves every finished feature as a pushed `feat/*` branch with an open PR. Nothing is ever merged: the morning PR review is the human checkpoint.

## Prerequisites (verified 3 Jul 2026)

| Check | State |
|---|---|
| Opt-in marker `.claude/nightly-autopilot.yml` with `publish: true` | required, human-approved |
| `PROJECT.md` roadmap with pending `[ ]` features | present (Phase 1.5, 11 features) |
| `.claude/test-cmd` TOFU-trusted | trusted: `npm run build && npm run lint && npm test` |
| `gh auth status` | logged in as `istefox` |
| CI workflow `.github/workflows/ci.yml` | present; `ci` check must be required on `main` |
| `nightly-guard.sh` hook installed | present |
| Manifests carry non-null `hook_verified` | yes (7/7, all `false`) |

## Launch order (evening)

1. Set a non-blocking permission mode: `acceptEdits` or bypass, so no per-tool prompt stalls the run.
2. Paste the outer keep-alive goal:

```
/goal "Every feature in PROJECT.md is [x], committed on feat/*, pushed, and a PR is open,
as shown by a NIGHTLY-PUBLISH line for each feature and no NIGHTLY-GUARD HALT line.
Or stop after 40 turns."
```

3. Invoke the skill:

```
/skill nightly-autopilot
```

Pre-flight runs read-only and aborts on any failure without pushing anything. After `pre-flight PASSED`, no question is asked until morning.

## Halt semantics

Run-level halt markers: `needs-human` (a feature failed to complete), `rtf-blocker` (review raised a BLOCKER), `token-budget` (goal overlay exhausted). Once any marker is set, the guard blocks every later publish: the whole roadmap stops rather than skipping a feature. A halted feature keeps its local commit but gets no PR.

Features marked `[~]` in `PROJECT.md` are skipped by design (needs-human). Tier 6 (mobile QA) and Tier 7 (store submission) contain manual steps and stay human-driven.

## Morning checklist

1. Read `.claude/nightly-report.json` (schema v2.1): per-feature status, branch, PR URL, CI state, guard halts, spend.
2. `gh pr list` and review each PR; CI must be green before merge.
3. Merge is manual, PR by PR. Auto-merge is rejected by design (ADR-0022).
4. On a HALT: check the marker named in the report, fix the cause, relaunch in the evening.

## Safety invariants (from the skill, binding)

No merge ever. No force-push, `feat/<slug>` branches only, never `main`. Publish requires this repo's `publish: true` marker. All safety hooks stay active during the run. TOFU trust is never auto-granted.
