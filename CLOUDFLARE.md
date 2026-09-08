# Cloudflare 배포

사이트와 API는 같은 Cloudflare Worker가 제공하고, 공유 데이터는 D1의 `shared_bosses` 테이블에 저장한다. 별도 설치형 서버는 필요 없다. 사이트 이용자는 로그인 없이 같은 데이터를 읽고 수정한다.

현재 배포 주소: https://union.union-raid.workers.dev

## 처음 설정

Node.js 22 이상을 설치한 뒤 프로젝트 폴더에서 실행한다.

```sh
npm install
npx wrangler login
npx wrangler d1 create union-db
```

현재 계정에는 `union-db`를 생성했고 `wrangler.jsonc`에 실제 ID를 연결했다. 이 계정에서는 다시 생성할 필요가 없다. 다른 계정으로 옮길 때만 DB를 생성하고 출력된 `database_id`로 설정을 바꾼다. 기존 ID는 `npx wrangler d1 list`로 확인한다. 첫 Worker 배포에는 가입 이메일 인증도 필요하다.

이 PC에서 `node`나 `npx`가 PATH에 없으면 PowerShell에서 기존 로컬 도구로 실행할 수 있다.

```powershell
$env:PATH = (Resolve-Path .sites-tools).Path + ';' + $env:PATH
& .sites-tools/node.exe node_modules/wrangler/bin/wrangler.js login
& .sites-tools/node.exe node_modules/wrangler/bin/wrangler.js d1 create union-db
```

## 테이블 생성과 배포

```sh
npm run db:remote
npm run deploy:cloudflare
```

`db:remote`는 `worker/schema.sql`을 실제 D1에 적용한다. `CREATE TABLE IF NOT EXISTS`이므로 기존 테이블과 데이터를 지우지 않는다. 배포 시 CP-SAT/WASM과 공개 사이트 파일을 자동으로 빌드한다. 배포 출력의 `https://union.<계정>.workers.dev` 주소를 이용자에게 전달한다.

`dist/client`에는 명시한 공개 파일과 이미지·WASM만 복사한다. DB 설정, 개발 도구, 테스트, 서버 코드는 정적 사이트에 포함하지 않는다. 별도로 생성된 `character-catalog.js`가 없으면 기존 `characters.js` 목록을 사용한다.

이후 코드 배포도 `npm run deploy:cloudflare`로 수행한다. GitHub Pages에 푸시하는 것만으로 Cloudflare에 배포되지는 않는다. 공유 기능은 Cloudflare 주소에서 사용한다.

## 공유 범위와 충돌 처리

- 딜량 파일 업로드와 배율은 D1에 저장하며, 기존 계획의 딜량 입력을 갱신하고 계산 결과를 무효화한다. 완료된 공격의 실제 딜은 유지한다. 완료한 파티를 삭제하거나 니케를 교체하는 파일은 거절한다.
- 계획·공격 잠금·실제 공격 결과·남은 공격권·사용 니케를 한 버전으로 함께 저장한다. 현재 보스 HP는 공유 보스 HP와 실제 공격 결과에서 계산한다.
- 기록 화면과 운영 화면의 보스 설정은 같은 데이터에 반영한다.
- 다른 사람이 먼저 저장하면 오래된 계획의 전체 저장은 HTTP 409로 거절한다. 화면은 최신 공유 상태를 불러오며, 사용자는 입력을 확인해 다시 저장한다. 공격 완료를 자동으로 재실행하지 않는다.
- 통신 실패·충돌 시 미저장 입력은 해당 브라우저의 `union-planner-unsaved` 또는 `union-unsaved-raidText` / `union-unsaved-multipliers` localStorage에 백업한다. 서버 저장 완료로 표시하지 않는다.
- 다른 기기의 변경은 새로고침하면 보인다. 보스 정보는 기존 주기 조회도 유지한다.
- 처음에는 저장소의 기본 데이터로 공유 계획을 생성한다. 기존 브라우저의 로컬 기록은 다른 사람의 공유 데이터를 덮어쓰지 않도록 자동 업로드하지 않는다. 기존 딜량 파일을 공유하려면 기록 화면에서 파일을 다시 불러온다.

## 로컬 검증

```sh
npm run db:local
npm run dev:cloudflare
```

별도 터미널에서 실행한다. 브라우저 검증은 `http://127.0.0.1:8787`의 **로컬 DB를 수정**하므로 테스트 전용 로컬 데이터에서 실행한다. 원격 DB는 수정하지 않는다.

```sh
npm run test:shared
node verify-cloudflare-browser.mjs
node verify-planner-objectives.mjs
npx wrangler deploy --dry-run
```

브라우저 검증은 Windows의 설치된 Chrome을 사용하며 다른 OS에서는 Playwright Chromium 설치가 필요하다. 기존 `verify-cpsat-browser.mjs`의 정적 서버 경로는 D1 API를 제공하지 않으므로 새 공유 화면 검증에는 위 Wrangler 검증을 사용한다.
