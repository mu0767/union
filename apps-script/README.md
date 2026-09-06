# Google Sheets 공유 저장

## 지정된 테스트 시트로 시작

현재 `Code.gs`의 기본 저장소는 사용자가 지정한 [테스트 시트](https://docs.google.com/spreadsheets/d/1BP1KR6qOReb8xihExZV16k5AW-4x8JA3ARN9qG6RhFU/edit)입니다. 별도 ID 입력 없이 다음 순서로 연결할 수 있습니다. 이미 프로젝트에 `SPREADSHEET_ID` 속성이 있다면 그 값이 우선하므로 삭제하거나 테스트 시트 ID로 맞추세요.

1. 해당 시트에서 **확장 프로그램 → Apps Script**를 엽니다.
2. `Code.gs`, `Index.html`, `Defaults.html`을 이 폴더의 파일 내용으로 추가합니다.
3. 편집기에서 `setup`을 실행하고 권한을 승인합니다. 새 `UnionBosses` 탭만 생성하며 기존 `gid=0` 탭은 변경하지 않습니다. 이어서 `checkConnection`을 실행해 로그의 `{"ok":true,"version":0,"bosses":16}`을 확인합니다. 기존 데이터가 있으면 version은 0보다 클 수 있습니다.
4. 웹 앱으로 **실행 사용자: 나 / 액세스 권한: 모든 사용자**로 배포하고 `/exec` URL을 사용합니다. 이 URL이 실제 조회·저장 테스트에 필요한 API/페이지 주소입니다. 시트 URL 자체는 API 주소가 아닙니다.

현재 환경에는 연결된 Google Sheets 문서 세션이나 Apps Script 배포 권한을 가진 도구가 없어 원격 setup과 배포는 실행하지 못했습니다. 시트 접근 권한과 실제 저장 성공도 아직 확인되지 않았습니다. 위 단계는 시트 소유자의 Google 승인 작업이며 일반 방문자에게는 필요하지 않습니다.

## 코드 분석과 범위

`index.html`은 `app.js`의 `raidRounds[round][index] = {name, element, hp}`를 보스 편집 화면과 기록 표/상세의 보스 표시에 사용합니다. 기존 `/api/bosses` 역시 이 구조와 보스별 `revisions`를 저장했습니다. 이 부분만 공유 대상으로 연결했습니다. 무한 체력은 기존처럼 브라우저에서 `Infinity`, 전송/저장에서 `"infinite"`입니다.

파일 불러오기는 원래 `union-raid-text` localStorage에 기록하고 현재 브라우저에만 적용했습니다. 이를 그대로 유지합니다. 기본 기록은 `data.js`로 모든 방문자에게 제공됩니다. `people`, 편성 파싱, 합계/배수 계산은 변경하지 않았습니다. 배수·검색·정렬·단계 선택·모달은 원래의 개인 화면 동작을 유지합니다.

`planner.html`은 별도 앱으로 localStorage와 Python `/api/solve`를 사용합니다. 이번 공유 저장 범위에 포함하지 않았으며, Apps Script만 배포해서 Python 최적화를 실행할 수는 없습니다. 원본의 레이드 운영 링크는 유지되어 있으므로 이 기능도 제공하려면 기존 운영 페이지 주소를 가진 정적 사이트를 `--asset-base`로 지정해야 합니다. 그 페이지의 Python 서버 의존성은 그대로입니다.

## 배포: Apps Script에서 페이지까지 제공 (권장)

일반 사용자는 완성된 `/exec` 링크만 엽니다. 관리자만 다음 설정을 합니다. 기본 빌드는 초상화까지 포함하므로 index 페이지용 별도 호스팅이 필요 없습니다.

1. 새 Google Spreadsheet를 만들고 URL의 `/d/`와 `/edit` 사이 ID를 복사합니다. 시트를 일반 사용자에게 공유하지 않습니다.
2. Apps Script 프로젝트를 만들고 `Code.gs` 내용을 넣습니다. 프로젝트 설정 → 스크립트 속성에 `SPREADSHEET_ID`를 추가합니다.
3. 로컬에서 `python build-apps-script.py`를 실행합니다. 현재 작업 환경에서는 `.\.venv\Scripts\python.exe build-apps-script.py`를 사용할 수 있습니다. 생성된 `Index.html`과 `Defaults.html`을 Apps Script의 같은 이름 HTML 파일에 붙여 넣습니다. 생성 파일을 직접 수정하지 말고 원본 수정 후 다시 빌드합니다.
4. 편집기에서 `setup`을 한 번 실행하고 관리자가 Sheets 접근을 승인합니다. `UnionBosses` 시트가 생깁니다. 이미 있으면 초기화를 거부하므로 기존 데이터가 덮어써지지 않습니다. 기존 서버 데이터를 옮기려면 처음 setup 실행 전에 Defaults에 기존 `rounds` 객체를 넣으세요.
5. 배포 → 새 배포 → 웹 앱. **실행 사용자: 나**, **액세스 권한: 모든 사용자(Anyone)**를 선택합니다. Google 계정이 있는 사용자만 허용하는 옵션과 구분합니다. 조직 정책 때문에 Anyone이 없다면 해당 계정에서는 요구한 익명 배포가 불가능합니다.
6. `/exec` 링크를 로그아웃/시크릿 창에서 열어 조회와 저장을 확인합니다. 코드 수정 후에는 배포 관리에서 새 버전으로 갱신합니다. `/dev`는 일반 사용자용 주소가 아닙니다.

이 구성은 링크를 가진 사람이 보스 정보를 조회·수정할 수 있는 공개 공동 편집 방식입니다. 클라이언트에 Google 자격 증명이나 시트 ID를 넣지 않습니다.

정적 사이트에서 원본 index를 제공하려면 `shared-config.js`의 `UNION_SHARED_URL`에 `/exec` URL을 설정하고 기존 파일들과 `boss-repository.js`, `shared-config.js`를 함께 배포합니다. POST는 CORS preflight를 피하는 `text/plain` JSON입니다. 배포 환경에서 리디렉션/CORS 응답을 반드시 확인하세요. 읽을 수 없는 `no-cors` 응답을 저장 성공으로 취급하지 않습니다. 권장 방식은 이 교차 출처 HTTP 경로 대신 `google.script.run`을 사용합니다.

## 저장과 동기화

- `BossRepository`가 version 조회, snapshot 조회, 변경분 저장을 담당합니다. 다른 저장소로 바꾸려면 이 계층과 서버 구현을 교체합니다.
- 요청 완료 후 3~5초 무작위 간격으로 version만 조회합니다. 같은 version이면 데이터 조회·렌더·계산이 없습니다. 변경 시 작은 보스 snapshot만 한 번 받고 필요한 보스 표시만 갱신합니다. 표의 행, 입력 DOM, 모달을 교체하지 않습니다.
- 숨겨진 탭은 polling을 쉬고 복귀 시 확인합니다. 요청을 중첩하지 않으며 통신 실패 시 최대 30초까지 간격을 늘립니다. API 응답 시간만큼 실제 반영 주기는 늘어날 수 있습니다.
- 기존 저장 버튼 의미를 유지했습니다. 타이핑은 즉시 입력창에 보이고, 버튼 클릭 시 현재 단계에서 수정한 필드만 백그라운드 저장합니다. 입력 도중 계산을 바꾸는 자동 저장은 도입하지 않았습니다.
- 초안은 단계 이동·polling·저장 실패 중 유지됩니다. 저장 중 추가로 입력한 값도 유지합니다. 같은 필드 충돌 시 저장 전체를 거부하고 이유를 표시합니다. `최신 정보 불러오기`는 초안을 지우지 않습니다. `현재 단계 입력 취소`로 해당 단계 초안을 버리고 최신 값에서 다시 수정할 수 있습니다.
- `LockService.getScriptLock()` 안에서 최신 데이터를 읽고 `{round,index,field,before,value}` 변경 목록을 검증·병합합니다. 다른 필드 수정은 병합하고 같은 필드의 값이 바뀌었으면 충돌로 처리합니다. 값이 이미 목표값이면 재시도로 판단해 중복 변경을 하지 않습니다. 전체 배치를 검증한 후 한 번 쓰므로 뒤쪽 필드 충돌로 앞쪽 필드만 저장되는 일이 없습니다.
- 기존 보스 revision을 유지하고 전체 version을 추가했습니다. 작은 기존 JSON을 B1에 저장하고 A1 version과 같은 `setValues`로 기록합니다. 클라이언트 전체 state를 서버에 덮어쓰는 API는 없습니다. 시트 셀은 API 전용으로 두세요. 직접 수정은 검증/version 처리를 우회합니다.

## 검증과 운영 한계

`python verify-shared.py`는 Chrome headless와 메모리 저장소로 실제 앱 스크립트를 실행합니다. 기본 로드, 32개 독립 필드 수정 병합, 같은 필드 충돌, 배치 원자성, 재시도, 무한 체력 규칙, version 동일 시 조회 생략, DOM/포커스 유지, 저장 실패/초안 유지, 요청 중첩 방지를 검사합니다. 실제 Google Sheets 통합/부하 검사를 대체하지 않습니다.

32개 활성 탭이면 평균 약 8회/초의 version 확인이며, 이 구현은 version 확인당 Sheets 셀 하나를 읽습니다. 전체 JSON은 변경 시에만 읽습니다. Apps Script는 실행 사용자당 동시 실행 30개, 스크립트당 1,000개 제한이 있으므로 요청 분산과 짧은 실행으로 충돌을 줄이되 32명 안정성을 수치만으로 보장할 수는 없습니다. 실제 배포에서 32개 탭으로 지연·실행 실패·할당량을 확인하세요. 브라우저의 32개 변경 모사 테스트는 실제 32명 부하 테스트가 아닙니다.

배포 확인: 두 시크릿 창에서 서로 다른 필드 저장 → 양쪽 반영, 같은 필드 저장 → 충돌 표시, 입력/모달/스크롤 중 원격 변경 → 화면 유지, 네트워크 차단 후 저장 → 실패 표시와 입력 유지, 다시 연결 후 재시도 → 다른 사람의 변경 보존.

공식 근거: [웹 앱 배포/실행 주체](https://developers.google.com/apps-script/guides/web), [비동기 google.script.run](https://developers.google.com/apps-script/guides/html/communication), [LockService](https://developers.google.com/apps-script/reference/lock/lock-service), [할당량과 동시 실행 제한](https://developers.google.com/apps-script/guides/services/quotas).
