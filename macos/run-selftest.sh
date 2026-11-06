#!/bin/bash
set -euo pipefail

MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$MACOS_DIR")"
BUILD="$MACOS_DIR/build"
APP="$MACOS_DIR/dist/논문 함께 읽기.app"
EXE="$APP/Contents/MacOS/ReadPaperTogether"
BUNDLE_ID="local.readpapertogether"
WEB_FILES=(index.html styles.css prompts.js app.js auth/callback/index.html)
PORT=38766
WEB_ROOT="$ROOT"

usage() {
  cat <<'EOF'
사용법: ./run-selftest.sh [--port N] [--web-root DIR]
  --port N        자체 시험용 포트 (기본 38766, 실제 앱의 38765 는 쓸 수 없음)
  --web-root DIR  웹 파일과 test/mock-openai.js 가 있는 폴더 (기본: 프로젝트 루트)
EOF
}

die() {
  echo "run-selftest.sh: $*" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port) [ $# -ge 2 ] || die "--port 뒤에 값이 필요합니다"; PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --web-root) [ $# -ge 2 ] || die "--web-root 뒤에 값이 필요합니다"; WEB_ROOT="$2"; shift 2 ;;
    --web-root=*) WEB_ROOT="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "알 수 없는 인자입니다: $1" ;;
  esac
done
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] && [ "$((10#$PORT))" -ge 1024 ] && [ "$((10#$PORT))" -le 65535 ] || die "--port 는 1024~65535 사이의 정수여야 합니다: $PORT"
PORT="$((10#$PORT))"
[ "$PORT" != 38765 ] || die "38765 는 실제 앱의 포트입니다. 다른 포트를 지정하세요."
[ -d "$WEB_ROOT" ] || die "웹 파일 폴더가 없습니다: $WEB_ROOT"
WEB_ROOT="$(cd "$WEB_ROOT" && pwd)"
MOCK="$WEB_ROOT/test/mock-openai.js"
[ -f "$MOCK" ] || die "mock 이 없습니다: $MOCK"

if [ "$PORT" = 38766 ]; then
  DATA="$BUILD/selftest-data"
  OUT="$BUILD/selftest-out"
else
  DATA="$BUILD/selftest-data-$PORT"
  OUT="$BUILD/selftest-out-$PORT"
fi
export TMPDIR="$BUILD/tmp"
mkdir -p "$TMPDIR"

needs_build() {
  local stamp="$APP/Contents/_CodeSignature/CodeResources" f
  [ -x "$EXE" ] && [ -f "$stamp" ] || return 0
  for f in "$MACOS_DIR"/Sources/* "$MACOS_DIR"/Tools/* "$MACOS_DIR"/Resources/* "$MACOS_DIR/build.sh"; do
    [ "$f" -nt "$stamp" ] && return 0
  done
  for f in "${WEB_FILES[@]}"; do
    cmp -s "$WEB_ROOT/$f" "$APP/Contents/Resources/web/$f" || return 0
  done
  return 1
}

if needs_build; then
  BUILD_ARGS=(--web-root "$WEB_ROOT")
  if [ -f "$APP/Contents/Info.plist" ]; then
    old_port="$(plutil -extract RPTPort raw -o - "$APP/Contents/Info.plist" 2>/dev/null || true)"
    old_data="$(plutil -extract RPTDataDirectory raw -o - "$APP/Contents/Info.plist" 2>/dev/null || true)"
    [ -n "$old_port" ] && BUILD_ARGS+=(--port "$old_port")
    [ -n "$old_data" ] && BUILD_ARGS+=(--data-dir "$old_data")
  fi
  "$MACOS_DIR/build.sh" "${BUILD_ARGS[@]}"
fi
VERSION="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")"

rm -rf "$DATA" "$OUT"
mkdir -p "$DATA" "$OUT"

cat > "$OUT/fake-upstream.py" <<'PY'
import http.server
import json
import time


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *args):
        pass

    def reply(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split('?')[0] != '/v1/models':
            return self.reply(404, {'error': 'not found'})
        self.reply(200, {
            'object': 'selftest',
            'authorization_ok': self.headers.get('Authorization') == 'Bearer selftest',
            'user_agent': self.headers.get('User-Agent', ''),
            'accept_encoding': self.headers.get('Accept-Encoding', ''),
        })

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if self.path.split('?')[0] != '/v1/responses':
            return self.reply(404, {'error': 'not found'})
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        for i in range(3):
            if i:
                time.sleep(0.2)
            self.wfile.write(('data: {"type":"selftest.%d"}\n\n' % (i + 1)).encode())
            self.wfile.flush()


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
PY

UP_PID=""
P1_PID=""
cleanup() {
  [ -n "$P1_PID" ] && kill "$P1_PID" 2>/dev/null || true
  [ -n "$UP_PID" ] && kill "$UP_PID" 2>/dev/null || true
}
trap cleanup EXIT

python3 -I "$OUT/fake-upstream.py" > "$OUT/fake-upstream.port" 2> "$OUT/fake-upstream.log" &
UP_PID=$!
UP_PORT=""
for _ in $(seq 1 50); do
  UP_PORT="$(head -n 1 "$OUT/fake-upstream.port" 2>/dev/null || true)"
  [ -n "$UP_PORT" ] && break
  sleep 0.1
done
[ -n "$UP_PORT" ] || die "가짜 상위 서버가 시작되지 않았습니다 ($OUT/fake-upstream.log)"

APP_ENV=(RPT_PORT="$PORT" RPT_DATA_DIR="$DATA" RPT_EXPORT_DIR="$OUT/exports" RPT_SELFTEST_OUT="$OUT"
  RPT_SELFTEST_MOCK="$MOCK" RPT_SELFTEST_CFG='{}' RPT_UPSTREAM="http://127.0.0.1:$UP_PORT" TMPDIR="$TMPDIR")
LIMIT=(perl -e 'alarm shift; exec { $ARGV[0] } @ARGV or die "exec: $!\n"')

echo "== 자체 시험: 논문 함께 읽기 $VERSION, 포트 $PORT, 데이터 $DATA"
echo "-- 1단계 (화면 왼쪽 아래에 시험 창이 잠깐 나타납니다)"
env "${APP_ENV[@]}" "${LIMIT[@]}" 200 "$EXE" --selftest > >(tee "$OUT/phase1.out") 2> "$OUT/phase1.err" &
P1_PID=$!

SECOND="FAIL"
SECOND_DETAIL="1단계 서버가 준비되지 않았습니다"
for _ in $(seq 1 150); do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/__rpt/health"; then
    set +e
    env "${APP_ENV[@]}" "${LIMIT[@]}" 30 "$EXE" --selftest > "$OUT/second.out" 2> "$OUT/second.err"
    code=$?
    set -e
    if [ "$code" = 3 ] && grep -q "이미 실행 중" "$OUT/second.err"; then
      SECOND="ok"
    else
      SECOND_DETAIL="종료 코드 $code: $(head -n 2 "$OUT/second.err" | tr '\n' ' ')"
    fi
    break
  fi
  kill -0 "$P1_PID" 2>/dev/null || break
  sleep 0.2
done
if [ "$SECOND" = ok ]; then
  echo "SELFTEST second-instance: ok"
else
  echo "SELFTEST second-instance: FAIL $SECOND_DETAIL"
fi

P1_CODE=0
wait "$P1_PID" || P1_CODE=$?
P1_PID=""
sleep 0.5

echo "-- 2단계 (같은 데이터 폴더로 다시 실행)"
P2_CODE=0
env "${APP_ENV[@]}" "${LIMIT[@]}" 200 "$EXE" --selftest=phase2 > >(tee "$OUT/phase2.out") 2> "$OUT/phase2.err" || P2_CODE=$?
sleep 0.5

kill "$UP_PID" 2>/dev/null || true
wait "$UP_PID" 2>/dev/null || true
UP_PID=""

echo "-- 홈 폴더(~/Library)와 사용자 캐시·임시 폴더에 생긴 이 앱의 항목"
C_DIR="$(getconf DARWIN_USER_CACHE_DIR)"
T_DIR="$(getconf DARWIN_USER_TEMP_DIR)"
LEFTOVERS="$(
  for d in WebKit Caches HTTPStorages Preferences "Saved Application State" "Application Support" Cookies Logs; do
    [ -d "$HOME/Library/$d" ] && find "$HOME/Library/$d" -maxdepth 3 -iname "*$BUNDLE_ID*" 2>/dev/null
  done
  [ -d "$HOME/Library/Logs/DiagnosticReports" ] && find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -iname 'ReadPaperTogether*' 2>/dev/null
  find "${C_DIR%/}" "${T_DIR%/}" -maxdepth 3 -iname "*$BUNDLE_ID*" 2>/dev/null
)" || true
if [ -n "$LEFTOVERS" ]; then
  while IFS= read -r p; do
    printf '   %6s  %s\n' "$(du -sh "$p" 2>/dev/null | cut -f1)" "$p"
  done <<< "$LEFTOVERS"
else
  echo "   (없음)"
fi

P1_RESULT="$( [ "$P1_CODE" = 0 ] && echo ok || echo "FAIL(종료 코드 $P1_CODE)" )"
P2_RESULT="$( [ "$P2_CODE" = 0 ] && echo ok || echo "FAIL(종료 코드 $P2_CODE)" )"
echo "== 요약: 1단계 $P1_RESULT · 두 번째 실행 $SECOND · 2단계 $P2_RESULT"
echo "   결과 폴더: $OUT (report.json, snapshot-*.png, 내보낸 파일, 로그)"
[ "$P1_CODE" = 0 ] && [ "$SECOND" = ok ] && [ "$P2_CODE" = 0 ]
