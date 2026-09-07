# 유니온 딜량 보드 / 레이드 플래너

현재 운영 페이지는 GitHub Pages의 정적 UI와 브라우저 Web Worker 기반 레이드 최적화기를 사용합니다. Python 서버나 Google Apps Script는 사용하지 않습니다.

- 메인: `index.html`
- 레이드 운영: `planner.html`
- 공유 보스 저장: `worker/index.js` + D1 스키마(`db/`, `drizzle/`)
- 레이드 계산: `planner-optimizer-ui.js` → `planner-cpsat-worker.js` → `planner-hybrid-engine-v3.js` → `planner-hybrid-engine-v2.js`

## 레이드 최적화 정책

목표는 수학적 최적성 증명보다 제한 시간 안에 실전에서 강한 전역 계획을 만드는 것입니다.

1. 가능한 가장 높은 라운드까지 진행합니다.
2. 최종보스에 도달하면 최종보스 딜을, 미도달이면 마지막 도달 라운드 유효 딜을 높입니다.
3. 작은 목표 딜 차이보다 앞 라운드의 큰 낭비와 구조적으로 잘못된 자원 배치를 줄입니다.
4. 일반 보스는 잔여 HP 10억 이하를 계획상 클리어로 인정합니다.
5. 레벨 보정 상대 효율, 속성/니케 희소성, HP 적합도를 이용해 Beam Search 초기해를 만듭니다.
6. 라운드 간 로컬 swap 후 CP-SAT으로 전역 개선하고, 마지막에 1:0 / 1:1 / 2:1 / 1:2 sanity 교환을 다시 검사합니다.
7. 모든 후보는 전역 개선 단계에 남기며 초기 배치를 고정하지 않습니다.
8. 기본 계산 제한은 전체 wall-clock 30초입니다.

회귀 기준과 구현 시 지켜야 할 규칙은 `AGENTS.md`를 따릅니다.

## 현재 핵심 파일

- `index.html`, `styles.css`, `app.js`: 딜량 기록/보스 정보 UI
- `planner.html`, `planner.css`, `planner.js`: 레이드 운영 UI와 상태 관리
- `planner-optimizer-ui.js`: 병렬 optimizer 실행과 결과 선택
- `planner-cpsat-worker.js`: 브라우저 계산 worker 진입점
- `planner-hybrid-engine-v2.js`: Beam Search + CP-SAT 전역 개선 기반 엔진
- `planner-hybrid-engine-v3.js`: 최종 neighborhood sanity 개선
- `verify-planner-objectives.mjs`: 목표 우선순위 회귀 테스트
- `verify-planner-global-optimization.mjs`: 전역 교환/오버딜/swap 회귀 테스트
- `build-cpsat.mjs`, `cpsat-vendor-entry.js`, `vendor/`: 브라우저 CP-SAT 런타임
- `build-character-catalog.mjs`: 캐릭터 카탈로그 생성
- `worker/index.js`, `db/`, `drizzle/`: 관리형 공유 저장
- `build-shared-site.py`: 관리형 Worker 번들 생성

## 데이터 갱신

`union_raid.txt`를 UTF-8로 수정한 뒤:

```powershell
powershell -ExecutionPolicy Bypass -File .\update-data.ps1
```

레벨 보정 기준은 `level_attack_power.json` / `level_attack_power.js`, 기본 보스 정보는 `default-bosses.json`에서 관리합니다.

## 배포

`.github/workflows/pages.yml`이 CP-SAT 빌드와 optimizer 회귀 테스트를 먼저 실행합니다. 두 optimizer 테스트가 모두 성공한 경우에만 GitHub Pages를 배포합니다.

캐릭터/이미지 권리는 원 권리자에게 있습니다.
