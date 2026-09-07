# 세션 인수인계

최종 갱신: 2026-09-07. 고정 목표·제약은 `AGENTS.md`를 따르고, 상세 구조는 `OPTIMIZER_DESIGN.md`를 따른다.

## 현재 최적화 방향

사용자는 수학적으로 100% 최대값을 증명하는 것보다 실제 레이드에서 충분히 높은 딜과 좋은 자원 배분을 30초 안에 얻는 것을 원한다.

현재 계산 경로:
`planner.js` → `planner-optimizer-ui.js` → `planner-cpsat-worker.js` → `planner-hybrid-engine-v2.js`

핵심 구조:
- 일반 보스는 잔여 HP 10억 이하를 계획상 클리어로 인정한다.
- 레벨 보정 상대 효율, 속성 희소성, 니케 희소성, HP 적합도를 사전 계산한다.
- 보스 하나가 4~8타 이상 필요할 수 있으므로 보스 내부에서도 nested beam으로 공격을 하나씩 추가한다.
- 전체 라운드에서는 Beam width 24로 상위 실행 가능 계획만 유지한다.
- 강한 공격만 앞 라운드에 몰지 않고, HP에 맞는 작은 공격과 섞어 이후 라운드 swap 여지를 남긴다.
- CP-SAT 전에 deterministic 1:1 라운드 swap을 반복한다.
- Beam+local 결과를 완성된 실행 가능 hint로 CP-SAT에 넣고, 모든 원래 후보를 유지한 채 큰 전역 교환을 탐색한다.
- CP-SAT 뒤에도 동일한 sanity swap을 다시 수행한다.
- 기본 전체 wall-clock은 30초이며, OPTIMAL 증명보다 best-so-far 품질을 우선한다.

## 반드시 막아야 하는 회귀

- R1 작열에 134,146,924,370이 이미 들어간 경우 15,990,954,991 공격으로 잔여 HP 703,934,239 / 실제 오버딜 0이 가능한데 20,304,443,028 공격을 선택하면 실패다.
- 설화의 공유 니케를 수냉에 쓰고 다른 유저가 작열을 담당해야 전체 진행이 좋아지는 경우 해당 전역 교환을 허용해야 한다.
- R1 필요 196, R2 필요 200이고 공격이 216/200이면 최종 배치는 `R1=200 / R2=216`이어야 한다.
- FEASIBLE 중간해에서 수백~수천억 낭비를 그대로 반환하면 안 된다.

회귀 스크립트:
- `verify-planner-objectives.mjs`
- `verify-planner-global-optimization.mjs`

## 구현 파일

- `planner-hybrid-engine-v2.js`: nested beam + local swap + CP-SAT global improvement + final sanity swap.
- `planner-cpsat-worker.js`: v2 hybrid engine 호출.
- `planner-optimizer-ui.js`: 30초 wall-clock, GitHub Pages에서 최대 4개 독립 seed worker portfolio.
- `OPTIMIZER_DESIGN.md`: 최적화 구조와 금지사항 상세 문서.
- 실제 사용 사이트: https://mu0767.github.io/union/planner.html

## 검증/배포

GitHub Pages workflow는 CP-SAT 빌드 후 optimizer 회귀 스크립트를 실행하며 실패하면 배포를 중단한다. 최신 커밋의 workflow 성공과 운영 사이트 반영은 별도로 확인한다.
