#!/usr/bin/env bash
# CI ONLY: actual packaged Electron; no user keys, public release or replay writes.
set -euo pipefail
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "STOP: Xvfb Electron boot requires Linux" >&2
  exit 1
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y xvfb
fi
stage="$(mktemp -d "${RUNNER_TEMP:-/tmp}/watcher-real-boot.XXXXXX")"
chmod 700 "$stage"
mkdir -p "$stage/home/.config" "$stage/home/.local/share" "$stage/empty-replays"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
bin_dir="$PWD/dist/linux-unpacked"
mapfile -t names < <(
  find "$bin_dir" -maxdepth 1 -type f -executable -printf '%f\n' |
    grep -i 'watcher' || true
)
if [[ "${#names[@]}" -ne 1 ]]; then
  echo "STOP: expected exactly one Watcher executable, got ${#names[@]}" >&2
  find "$bin_dir" -maxdepth 1 -type f -printf '%f\n' >&2
  exit 1
fi
binary="$bin_dir/${names[0]}"
setsid env \
  HOME="$stage/home" \
  XDG_CONFIG_HOME="$stage/home/.config" \
  XDG_DATA_HOME="$stage/home/.local/share" \
  AOE2_UPLOAD_API_KEY="" \
  AOE2_WATCH_DIR="$stage/empty-replays" \
  AOE2_TELEMETRY_HEARTBEAT_MS=0 \
  AOE2_API_BASE_URL="http://127.0.0.1:9" \
  AOE2_API_FALLBACK_BASE_URL="http://127.0.0.1:9" \
  AOE2_TELEMETRY_BASE_URL="http://127.0.0.1:9" \
  AOE2_UPDATE_FEED_URL="http://127.0.0.1:9/downloads" \
  xvfb-run -a -s "-screen 0 1280x960x24" \
  "$binary" --no-sandbox --disable-gpu --disable-dev-shm-usage \
  > "$stage/boot.log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 35); do
  if grep -Fq 'Runtime initialized:' "$stage/boot.log" &&
     grep -Fq 'Dashboard renderer ready' "$stage/boot.log"; then
    ready=1
    break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "STOP: packaged Electron exited before renderer readiness" >&2
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "STOP: packaged Electron main/renderer not ready" >&2
  tail -n 90 "$stage/boot.log" >&2
  exit 1
fi
echo "PACKAGED_LINUX_ELECTRON_MAIN_AND_RENDERER_BOOT_PASS"
