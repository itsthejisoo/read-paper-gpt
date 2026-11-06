# 논문 함께 읽기 — macOS 앱

웹 버전(`index.html`, `app.js` …)을 그대로 담은 macOS 앱입니다. 앱 안에 작은 로컬 서버가 들어 있어서 `python3 serve.py` 를 따로 실행하지 않아도 ChatGPT 로그인과 플랜 호출 relay가 됩니다. 화면과 기능(요약, 전문 번역, 주제 제안, 원문, 내보내기)은 웹 버전과 같습니다.

- 요구 사항: Apple Silicon Mac, macOS 13 이상, Xcode Command Line Tools(`xcode-select --install`). Xcode 앱은 필요 없습니다.
- 앱 위치: `macos/dist/논문 함께 읽기.app`
- 데이터 위치: `macos/data` (로그인 토큰, 분석 기록, 창 위치)

## 빌드

```bash
cd /Volumes/RB/read_paper_together/macos
./build.sh
```

처음에는 30–40초쯤 걸리고, 그다음부터는 바뀐 부분만 다시 만듭니다. 결과는 `macos/dist/논문 함께 읽기.app` 입니다. 앱 버전은 `app.js` 의 `VERSION` 을 따릅니다.

| 옵션 | 뜻 |
| --- | --- |
| `--port N` | 앱 내장 서버 포트 (기본 `38765`) |
| `--install` | `~/Applications` 에도 복사해 Spotlight 에서 "논문 함께 읽기" 로 바로 실행 (약 1.5MB, 데이터는 그대로 `macos/data`). /Volumes/RB 는 Spotlight 색인이 꺼져 있어 `dist/` 의 앱은 검색되지 않습니다. 다시 빌드할 때도 `--install` 을 붙이면 사본이 갱신됩니다. |
| `--data-dir PATH` | 데이터 폴더 (기본 `macos/data`) |
| `--web-root DIR` | 앱에 넣을 웹 파일 폴더 (기본: 프로젝트 루트) |
| `--clean` | `macos/build` 안의 빌드 중간 산출물(`tmp`, `ModuleCache`, `obj`, `stage`, 아이콘 파일)만 지우고 끝냅니다. 앱과 데이터는 그대로 둡니다. |

빌드 중 임시 파일과 module cache는 모두 `macos/build` 에 둡니다(`TMPDIR`, `CLANG_MODULE_CACHE_PATH`). 홈 폴더에는 쓰지 않습니다.

## 실행

`macos/dist/논문 함께 읽기.app` 을 더블클릭하거나 Dock으로 끌어다 두고 실행합니다. 이 Mac에서 직접 빌드한 앱은 quarantine 속성이 없어서 Gatekeeper 경고 없이 열립니다(ad-hoc 서명이라 다른 Mac으로 복사하면 막힐 수 있습니다). 앱을 다른 곳으로 옮겨도 데이터는 계속 `macos/data` 에 저장됩니다(빌드할 때 경로가 앱에 기록됩니다).

- 창을 닫으면 앱이 종료됩니다. 분석이 진행 중일 때는 종료(⌘Q, 창 닫기)나 새로 고침(⌘R) 전에 확인을 묻습니다.
- 메뉴: 설정 ⌘, · 새로 고침 ⌘R · 확대 ⌘+ / 축소 ⌘- / 실제 크기 ⌘0 · 도움말 > 데이터 폴더 열기
- 같은 데이터 폴더로 두 번 실행하면 이미 열린 창을 앞으로 가져오고 새 실행은 끝납니다.
- 논문 원문 링크나 Google Scholar 같은 외부 링크는 기본 브라우저에서 열립니다. 내보내기(Markdown/HTML)는 저장 패널로 저장하며, 처음에는 `macos/exports` 폴더가 열립니다.

## ChatGPT 로그인

1. 첫 화면에서 **ChatGPT로 계속하기**를 누르면 기본 브라우저에서 ChatGPT 로그인 페이지가 열립니다.
2. 브라우저에서 로그인하고 허용하면 "로그인 완료" 페이지가 뜨고, 앱 창이 자동으로 로그인된 상태가 됩니다. 브라우저 탭은 닫아도 됩니다.
3. 처음 로그인하면 ChatGPT 계정에 이 앱의 연결(**Read Paper Together**)이 새로 등록됩니다. 웹 버전(`serve.py`)으로 로그인한 연결과는 별개라서, 웹 버전에서 로그아웃해도 앱의 로그인은 유지되고 그 반대도 마찬가지입니다.

API 키 로그인도 웹 버전과 똑같이 쓸 수 있습니다. 토큰과 키는 `macos/data` 안의 WebKit 저장소에만 저장되고, 내장 서버는 아무것도 기록하지 않습니다. 앱 상단의 **로그아웃**을 누르면 연결이 해제되고 토큰이 지워집니다.

## 데이터와 디스크 사용

모든 데이터는 `/Volumes/RB` 에 둡니다.

| 경로 | 내용 |
| --- | --- |
| `macos/data/WebKit` | 로그인 토큰, 분석 기록(localStorage, IndexedDB), WebKit cache |
| `macos/data/window.json` | 마지막 창 위치와 크기 |
| `macos/data/state.json` | 마지막으로 내보낸 폴더 |
| `macos/exports` | 내보내기 저장 패널의 처음 폴더 |

`macos/data` 를 지우면 로그아웃되고 분석 기록도 모두 사라집니다(앱을 종료한 뒤 지우세요).

앱은 WebKit 저장소를 데이터 폴더로 지정하고 창 상태 복원(Saved Application State)을 끄므로 `~/Library/WebKit`, `~/Library/Caches`, `~/Library/HTTPStorages`, `~/Library/Saved Application State` 에는 아무것도 만들지 않습니다. 시험(2026-11-06, 자체 시험과 수동 실행을 여러 차례 반복)에서 홈 폴더 밖, macOS가 관리하는 사용자별 임시·캐시 폴더(`getconf DARWIN_USER_TEMP_DIR`, `getconf DARWIN_USER_CACHE_DIR`, `/var/folders/…` 아래)에 다음 빈 폴더만 생겼습니다. macOS의 WebKit과 Metal이 직접 만드는 것이라 앱에서 위치를 바꿀 수 없습니다.

| 경로 | 크기 | 만드는 곳 |
| --- | --- | --- |
| `…/C/local.readpapertogether/com.apple.metalfe` | 0 B (빈 폴더) | Metal(GPU) shader cache |
| `…/T/local.readpapertogether/WebKit/ModelElement` | 0 B (빈 폴더) | WebKit |
| `…/T/BlobRegistryFiles-xxxxxxxx` | 0 B (빈 폴더, 실행할 때마다 1개) | WebKit networking process. WebKit을 쓰는 다른 앱도 같은 이름으로 만듭니다. |

저장 패널이나 PDF 선택 패널을 쓰면 macOS가 마지막 폴더 같은 패널 설정을 `~/Library/Preferences/local.readpapertogether.plist`(수 KB)에 저장할 수 있습니다. 자체 시험은 패널을 띄우지 않으므로 시험 중에는 생기지 않았습니다.

## 포트

앱은 `http://127.0.0.1:38765` 에서 내장 서버를 엽니다(루프백 전용). 웹 버전의 `serve.py`(기본 8000)와 동시에 써도 됩니다. 다른 프로그램이 38765를 쓰고 있으면 "포트 38765를 다른 프로그램이 사용하고 있습니다" 경고가 뜹니다. 그 프로그램을 끄거나 다른 포트로 다시 빌드하세요.

```bash
./build.sh --port 38770
```

로그인 정보는 주소(포트) 단위로 저장되므로 포트를 바꾸면 한 번 다시 로그인해야 합니다.

## 웹 파일을 고친 뒤 (업데이트)

앱은 빌드할 때 웹 파일을 복사해 둡니다. `index.html`, `styles.css`, `prompts.js`, `app.js` 를 고쳤다면 앱을 종료하고 `./build.sh` 를 다시 실행하세요. 데이터(`macos/data`)는 그대로 유지됩니다.

## 자체 시험

```bash
./run-selftest.sh                 # 포트 38766, 데이터 macos/build/selftest-data
./run-selftest.sh --port 38767    # 다른 포트(데이터·결과 폴더도 포트별로 따로)
```

화면 왼쪽 아래에 시험 창이 잠깐 나타납니다. 가짜 OpenAI(`test/mock-openai.js`)와 가짜 relay 상위 서버만 쓰므로 실제 ChatGPT·OpenAI에는 아무것도 보내지 않고, 실제 앱(포트 38765, `macos/data`)과 함께 켜 둬도 됩니다.

- 1단계: 보안 컨텍스트, health, 페이지에서 내장 relay 호출(streaming 포함), ChatGPT 로그인 가로채기와 콜백(잘못된 state 거부), 모델 목록, 분석, 요약 다섯 제목(결과 및 장점 포함), Markdown 내보내기(`# 주제 제안` 포함, 저장 패널이 늦게 닫히는 경우 포함), 주제 제안 탭, 외부 링크, 새로 고침 뒤 복원, WebKit 저장 위치
- 같은 데이터 폴더로 두 번째 실행 → 종료 코드 3
- 2단계: 같은 데이터로 다시 실행 → 로그인 유지, 기록 1개, 결과와 주제 제안을 API 호출 없이 다시 열기

결과는 `macos/build/selftest-out` 에 남습니다(`report.json`, 화면 스냅숏 `snapshot-*.png`, 내보낸 파일, 로그). 끝에 홈 폴더와 사용자 임시·캐시 폴더에 생긴 이 앱의 항목을 크기와 함께 보여 줍니다.

내장 서버만 띄워 `test/proxy-test.js` 로 확인할 수도 있습니다.

```bash
APP="/Volumes/RB/read_paper_together/macos/dist/논문 함께 읽기.app"
SERVE_CMD="$APP/Contents/MacOS/ReadPaperTogether" SERVE_ARGS=--serve-only \
  SERVE_VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")" \
  node ../test/proxy-test.js
```

## 삭제

1. 앱을 종료합니다.
2. `macos/dist`(앱), `macos/data`(토큰·기록), `macos/exports`, `macos/build` 를 지웁니다.
3. 원하면 위 표의 빈 폴더(`…/C/local.readpapertogether`, `…/T/local.readpapertogether`)와 `~/Library/Preferences/local.readpapertogether.plist`(있다면)도 지웁니다.
4. ChatGPT 연결까지 정리하려면 2번 전에 앱에서 **로그아웃**하세요.

## 문제 해결

- **"포트 38765를 다른 프로그램이 사용하고 있습니다"**: `lsof -nP -iTCP:38765 -sTCP:LISTEN` 으로 어떤 프로그램인지 확인해 끄거나, `./build.sh --port N` 으로 다른 포트를 쓰세요.
- **"데이터 폴더에 접근할 수 없습니다"**: 외장 디스크 `/Volumes/RB` 가 연결되어 있지 않습니다. 디스크를 연결한 뒤 다시 실행하세요. 앱은 내부 디스크에 대신 저장하지 않습니다.
- **"이미 실행 중입니다"**: 같은 데이터 폴더를 쓰는 앱이 이미 열려 있습니다. Dock에서 그 창을 쓰세요.
- **로그인 뒤 앱으로 돌아오지 않음**: 브라우저의 "로그인 완료" 페이지에서 **앱으로 돌아가기**를 누르세요. 그래도 안 되면 앱에서 **ChatGPT로 계속하기**를 다시 누르세요(로그인 요청은 10분 동안 유효합니다).
- **화면이 비거나 멈춤**: ⌘R로 새로 고침합니다. 페이지 프로세스가 연달아 종료되면 다시 불러오기를 묻는 창이 뜹니다.
- **빌드 실패 "xcrun: error"**: `xcode-select --install` 로 Command Line Tools를 설치하세요.
