#!/usr/bin/env bash
# Drive the Kant "uireview" build on a USB-connected Android phone.
#
#   phone.sh build              build the debug APK as com.kant.messenger.uireview and install it
#                               (sits next to the real Kant install; never touches its data)
#   phone.sh launch             bring the review build to the front
#   phone.sh shot NAME          screenshot -> $SHOTS/NAME.png + NAME.jpg (432 px wide, cheap to read)
#   phone.sh tap X Y            tap at X,Y measured on the 432-px-wide jpg
#   phone.sh text "Button"      real tap on the visible button/menu item whose text or aria-label is exactly "Button"
#   phone.sh click "Label"      JS click on the last visible button whose text starts with "Label" (no real touch)
#   phone.sh eval 'js expr'     evaluate JS in the app's WebView, print the JSON result
#   phone.sh back               Android back button
#
# Every tap first checks that the review build is in front, so a stray tap never lands on the launcher.
set -euo pipefail
PKG=com.kant.messenger.uireview
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
APP=$ROOT/packages/app
SHOTS=${SHOTS:-/tmp/kant-shots}
mkdir -p "$SHOTS"

front() { adb shell dumpsys activity activities | grep -m1 topResumedActivity | grep -q "$PKG"; }
need_front() { front || { echo "Kant review build is not in front; run: phone.sh launch" >&2; exit 1; }; }

cdp() {
  local pid; pid=$(adb shell pidof "$PKG" | tr -d '\r')
  [ -n "$pid" ] || { echo "review build is not running" >&2; exit 1; }
  adb forward tcp:9333 "localabstract:webview_devtools_remote_$pid" >/dev/null
  node --input-type=module -e '
    const expr = process.argv[1];
    const list = await (await fetch("http://localhost:9333/json")).json();
    const ws = new WebSocket(list.find(p => p.type === "page").webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { const r = m.result; console.log(JSON.stringify(r.exceptionDetails ? r.exceptionDetails.exception?.description : r.result?.value)); ws.close(); } };
  ' "$1"
}

case "${1:-}" in
  build)
    # Debug build as a separate app id, without a baked-in relay (so the network step shows).
    # google-services.json is gitignored and only matches com.kant.messenger, so park it during the build.
    cd "$APP"
    GS=android/app/google-services.json; PARK=$(mktemp -d)
    [ -f "$GS" ] && mv "$GS" "$PARK/"
    cp android/app/build.gradle "$PARK/build.gradle"
    restore() { cp "$PARK/build.gradle" android/app/build.gradle; [ -f "$PARK/google-services.json" ] && mv "$PARK/google-services.json" "$GS"; }
    trap restore EXIT
    sed -i 's/    buildTypes {/    buildTypes {\n        debug { applicationIdSuffix ".uireview" }/' android/app/build.gradle
    env -u VITE_RELAY_URL JAVA_HOME=${JAVA_HOME_21:-/usr/lib/jvm/java-21-openjdk} pnpm run build:android:debug
    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    ;;
  launch) adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 1.5 ;;
  shot)
    adb exec-out screencap -p > "$SHOTS/$2.png"
    magick "$SHOTS/$2.png" -resize 432x -quality 80 "$SHOTS/$2.jpg"
    echo "$SHOTS/$2.jpg" ;;
  tap) need_front; adb shell input tap $(( $2 * 5 / 2 )) $(( $3 * 5 / 2 )) ;;
  text)
    need_front
    q=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")
    r=$(cdp "(()=>{const t=$q; const e=[...document.querySelectorAll('button,[role=menuitem],a,[role=switch]')].find(e=>(e.textContent.trim()===t||e.getAttribute('aria-label')===t)&&e.getClientRects().length); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round((b.left+b.width/2)*devicePixelRatio), Math.round((b.top+b.height/2)*devicePixelRatio)]})()")
    echo "$r" | grep -q '\[' || { echo "not found: $2" >&2; exit 1; }
    x=$(echo "$r" | tr -d '[] \n' | cut -d, -f1); y=$(echo "$r" | tr -d '[] \n' | cut -d, -f2)
    # The WebView starts below the status bar (the app is not edge-to-edge yet): add its height.
    # 136 px on the Nothing Phone; after edge-to-edge (task 1.2) run with TOP=0.
    adb shell input tap "$x" $(( y + ${TOP:-136} )) ;;
  click)
    q=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")
    cdp "(()=>{const t=$q; const b=[...document.querySelectorAll('button,a,[role=menuitem]')].filter(e=>e.getClientRects().length).reverse().find(e=>e.textContent.trim().startsWith(t)); if(!b) return 'not found'; b.click(); return 'clicked'})()" ;;
  eval) cdp "$2" ;;
  back) need_front; adb shell input keyevent KEYCODE_BACK ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
