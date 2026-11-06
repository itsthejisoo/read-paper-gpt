#!/bin/bash
set -euo pipefail

MACOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$MACOS_DIR")"
BUILD="$MACOS_DIR/build"
DIST="$MACOS_DIR/dist"
SRC="$MACOS_DIR/Sources"
APP_NAME="논문 함께 읽기"
EXE="ReadPaperTogether"
BUNDLE_ID="local.readpapertogether"
WEB_FILES=(index.html styles.css prompts.js app.js auth/callback/index.html)
INTERMEDIATES=(tmp ModuleCache obj stage MakeIcon AppIcon.iconset AppIcon.icns)

PORT=38765
DATA_DIR="$MACOS_DIR/data"
EXPORT_DIR="$MACOS_DIR/exports"
WEB_ROOT="$ROOT"
CLEAN=0

usage() {
  cat <<'EOF'
사용법: ./build.sh [--port N] [--data-dir PATH] [--web-root DIR] [--clean]
  --port N         앱 내장 서버 포트 (기본 38765)
  --data-dir PATH  로그인 정보·분석 기록을 둘 폴더 (기본 macos/data)
  --web-root DIR   앱에 넣을 웹 파일이 있는 폴더 (기본: 프로젝트 루트)
  --clean          build/ 안의 빌드 중간 산출물만 지우고 끝낸다 (dist/ 의 앱과 data/ 는 그대로)
EOF
}

die() {
  echo "build.sh: $*" >&2
  exit 1
}

need_value() {
  [ "$2" -ge 2 ] || die "$1 뒤에 값이 필요합니다"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port) need_value "$1" $#; PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --data-dir) need_value "$1" $#; DATA_DIR="$2"; shift 2 ;;
    --data-dir=*) DATA_DIR="${1#*=}"; shift ;;
    --web-root) need_value "$1" $#; WEB_ROOT="$2"; shift 2 ;;
    --web-root=*) WEB_ROOT="${1#*=}"; shift ;;
    --clean) CLEAN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "알 수 없는 인자입니다: $1" ;;
  esac
done

if [ "$CLEAN" = 1 ]; then
  for name in "${INTERMEDIATES[@]}"; do
    if [ -e "$BUILD/$name" ]; then
      rm -rf "${BUILD:?}/$name"
      echo "지움: $BUILD/$name"
    fi
  done
  exit 0
fi

[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$PORT))" -ge 1 ] && [ "$((10#$PORT))" -le 65535 ] || die "--port 는 1~65535 사이의 정수여야 합니다: $PORT"
PORT="$((10#$PORT))"
[ -n "$DATA_DIR" ] || die "--data-dir 가 비어 있습니다"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$PWD/$DATA_DIR" ;; esac
[ -d "$WEB_ROOT" ] || die "웹 파일 폴더가 없습니다: $WEB_ROOT"
WEB_ROOT="$(cd "$WEB_ROOT" && pwd)"
for f in "${WEB_FILES[@]}"; do
  [ -f "$WEB_ROOT/$f" ] || die "웹 파일이 없습니다: $WEB_ROOT/$f"
done
VERSION="$(sed -nE "s/^[[:space:]]*const VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';.*/\1/p" "$WEB_ROOT/app.js" | head -n 1)"
[ -n "$VERSION" ] || die "$WEB_ROOT/app.js 에서 const VERSION = 'x.y.z' 를 찾지 못했습니다"

export TMPDIR="$BUILD/tmp"
export CLANG_MODULE_CACHE_PATH="$BUILD/ModuleCache"
mkdir -p "$TMPDIR" "$CLANG_MODULE_CACHE_PATH" "$BUILD/obj"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
SWIFTC="$(xcrun --sdk macosx -f swiftc)"
CLANG="$(xcrun --sdk macosx -f clang)"
SELF="$MACOS_DIR/build.sh"

stale() {
  local out="$1" input
  shift
  [ -e "$out" ] || return 0
  for input in "$@"; do
    [ "$input" -nt "$out" ] && return 0
  done
  return 1
}

echo "== 논문 함께 읽기 $VERSION 빌드 (웹 파일: $WEB_ROOT)"
if stale "$BUILD/obj/DataStore.o" "$SRC/DataStore.m" "$SRC/DataStore.h" "$SELF"; then
  echo "-- clang DataStore.m"
  "$CLANG" -c -fobjc-arc -fmodules "-fmodules-cache-path=$CLANG_MODULE_CACHE_PATH" -mmacosx-version-min=13.0 -arch arm64 \
    -isysroot "$SDK" -O2 -Wall "$SRC/DataStore.m" -o "$BUILD/obj/DataStore.o"
fi

SWIFT_SOURCES=("$SRC"/*.swift)
if stale "$BUILD/obj/$EXE" "${SWIFT_SOURCES[@]}" "$SRC/Bridging-Header.h" "$SRC/DataStore.h" "$BUILD/obj/DataStore.o" "$SELF"; then
  echo "-- swiftc ($((${#SWIFT_SOURCES[@]})) 파일)"
  "$SWIFTC" -O -swift-version 5 -target arm64-apple-macos13.0 -sdk "$SDK" -module-cache-path "$CLANG_MODULE_CACHE_PATH" \
    -module-name "$EXE" -import-objc-header "$SRC/Bridging-Header.h" "${SWIFT_SOURCES[@]}" "$BUILD/obj/DataStore.o" \
    -framework AppKit -framework WebKit -framework Network -o "$BUILD/obj/$EXE"
fi

ICON_SOURCE="$MACOS_DIR/Resources/AppIcon-source.png"
[ -f "$ICON_SOURCE" ] || die "아이콘 원본 그림이 없습니다: $ICON_SOURCE"
if stale "$BUILD/AppIcon.icns" "$MACOS_DIR/Tools/MakeIcon.swift" "$ICON_SOURCE"; then
  echo "-- 아이콘"
  "$SWIFTC" -O -swift-version 5 -target arm64-apple-macos13.0 -sdk "$SDK" -module-cache-path "$CLANG_MODULE_CACHE_PATH" \
    "$MACOS_DIR/Tools/MakeIcon.swift" -o "$BUILD/MakeIcon"
  rm -rf "$BUILD/AppIcon.iconset"
  "$BUILD/MakeIcon" "$BUILD/AppIcon.iconset" "$ICON_SOURCE"
  iconutil -c icns "$BUILD/AppIcon.iconset" -o "$BUILD/AppIcon.icns"
fi

xml() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  printf '%s' "$s"
}

STAGE="$BUILD/stage"
STAGED_APP="$STAGE/$APP_NAME.app"
rm -rf "$STAGE"
mkdir -p "$STAGED_APP/Contents/MacOS" "$STAGED_APP/Contents/Resources/web"
cp -X "$BUILD/obj/$EXE" "$STAGED_APP/Contents/MacOS/$EXE"
cp -X "$BUILD/AppIcon.icns" "$STAGED_APP/Contents/Resources/AppIcon.icns"
for f in "${WEB_FILES[@]}"; do
  mkdir -p "$(dirname "$STAGED_APP/Contents/Resources/web/$f")"
  cp -X "$WEB_ROOT/$f" "$STAGED_APP/Contents/Resources/web/$f"
done
printf 'APPL????' > "$STAGED_APP/Contents/PkgInfo"
cat > "$STAGED_APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>ko</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$EXE</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d.%H%M)</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>$BUNDLE_ID</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>CFBundleURLSchemes</key><array><string>readpapertogether</string></array>
    </dict>
  </array>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSSupportsAutomaticTermination</key><false/>
  <key>NSSupportsSuddenTermination</key><false/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
  <key>NSHumanReadableCopyright</key><string>논문 함께 읽기 · 이 컴퓨터에서만 동작하는 개인용 앱</string>
  <key>RPTPort</key><integer>$PORT</integer>
  <key>RPTDataDirectory</key><string>$(xml "$DATA_DIR")</string>
  <key>RPTExportDirectory</key><string>$(xml "$EXPORT_DIR")</string>
</dict>
</plist>
PLIST
plutil -lint "$STAGED_APP/Contents/Info.plist" >/dev/null || die "Info.plist 가 올바르지 않습니다"
xattr -cr "$STAGED_APP"
codesign --force --sign - --timestamp=none "$STAGED_APP"
codesign --verify --strict "$STAGED_APP" || die "서명 확인에 실패했습니다"

mkdir -p "$DIST"
rm -rf "${DIST:?}/$APP_NAME.app"
mv "$STAGED_APP" "$DIST/"
rmdir "$STAGE"
echo "== 완료: $DIST/$APP_NAME.app (버전 $VERSION, 포트 $PORT, 데이터 $DATA_DIR)"
du -sh "$DIST/$APP_NAME.app"
