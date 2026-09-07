# Repository working rules

## Raid optimizer objective

The planner is a practical anytime global optimizer. Do not optimize one round independently and do not spend the time budget proving tiny numerical differences.

Priority:
1. Reach the highest possible raid stage.
2. If Final is reached, maximize Final damage; otherwise maximize effective damage in the last reachable normal round.
3. Within a practically equivalent target range, reduce earlier-round planning waste/overkill and preserve useful attacks/resources.

Normal bosses with at most 1,000,000,000 HP remaining count as cleared for planning purposes. UI actual overkill remains true damage beyond actual HP.

## Current runtime path

`planner.js` → `planner-optimizer-ui.js` → `planner-cpsat-worker.js` → `planner-hybrid-engine-v3.js` → `planner-hybrid-engine-v2.js`

- v2 builds feasible initial plans with nested Beam Search, applies local cross-round swaps, then uses global CP-SAT improvement.
- v3 performs the final deterministic neighborhood cleanup: 1:0 removal, 1:1 swap, 2:1 replacement and 1:2 split.
- Default total wall-clock budget is 30 seconds.
- Initial efficiency preferences are guidance only. Never delete/fix lower-efficiency candidates merely because another candidate scores better locally.

## Initial-plan policy

Use level-normalized per-element relative efficiency, HP fit, element supply/scarcity, shared-Nikke opportunity cost and attack availability to guide initial solutions. Avoid packing only the strongest attacks into early rounds; keeping strong + medium/smaller attacks mixed can improve later swap flexibility.

A good initial solution must be fully feasible with attacks-left and per-user Nikke non-reuse constraints. It is a hint, not a fixed assignment.

## Required global behavior

Always allow cross-round/cross-user restructuring when it improves the global result. Obvious cases such as placing a 216 attack in R1 with 20 waste while a compatible 200 attack is in R2 must be removable by deterministic cleanup rather than relying only on CP-SAT discovery.

Shared-Nikke opportunity cost matters. Example regression: if 설화's water/fire parties share 아니스 and another user can cover fire, the optimizer must be able to choose 설화-water + other-fire instead of locally locking 설화-fire.

## Regression cases

Do not regress these cases:
- Normal boss clear tolerance: <= 1B HP remaining counts as clear.
- Fire overkill fixture: after 134,146,924,370 prior damage into 150,841,813,600 HP, prefer 15,990,954,991 over 20,304,443,028 when the former clears under tolerance.
- Shared-Nikke global swap fixture (설화/아니스).
- Cross-round 216/200 swap fixture.
- Small target values must not use a coarse tolerance large enough to erase the whole target.

## Tests and deployment

The Pages workflow must run and pass:
- `verify-planner-objectives.mjs`
- `verify-planner-global-optimization.mjs`

A failed optimizer regression must block deployment. Do not claim a change is deployed until the latest GitHub Pages workflow for the latest commit has completed successfully.

## Keep the repository current

Do not restore retired Python solver/server, Google Apps Script, old optimizer engines or duplicate handoff/design documents. Current implementation and policy belong in the runtime files, this file, and `README.md` only.
