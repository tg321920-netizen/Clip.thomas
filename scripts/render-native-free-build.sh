#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="$ROOT/.runtime"
WHISPER_SRC="$RUNTIME_ROOT/src/whisper.cpp"
WHISPER_COMMIT="d09f61a708f3487afa956ff578e60eae5e7a233c"
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
ESPEAK_SRC="$RUNTIME_ROOT/src/espeak-ng"
ESPEAK_PREFIX="$RUNTIME_ROOT/espeak"
ESPEAK_COMMIT="4870adfa25b1a32b4361592f1be8a40337c58d6c"
YTDLP_KICK_REF="04d2933856d7ddc5e088dab2d8328952c6986896"
YTDLP_PYTHON_ROOT="$RUNTIME_ROOT/yt-dlp-python"
YTDLP_MARKER="$YTDLP_PYTHON_ROOT/.clipforge-ref"
TOOLING_ROOT="$RUNTIME_ROOT/tooling"

cd "$ROOT"
mkdir -p "$RUNTIME_ROOT/bin" "$RUNTIME_ROOT/models" "$RUNTIME_ROOT/src"

# Render native images are allowed to change their preinstalled packages. Keep
# the runtime self-contained: use host FFmpeg/FFprobe when both exist, otherwise
# install pinned static npm binaries during the build and copy only the binaries
# into the deploy artifact.
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "[render-native] host FFmpeg/FFprobe incomplete; provisioning static binaries."
  rm -rf "$TOOLING_ROOT"
  mkdir -p "$TOOLING_ROOT"
  npm install \
    --prefix "$TOOLING_ROOT" \
    --no-save \
    --no-package-lock \
    --ignore-scripts=false \
    ffmpeg-static@5.2.0 \
    ffprobe-static@3.1.0

  FFMPEG_STATIC="$(node -e 'process.stdout.write(require(process.argv[1]))' "$TOOLING_ROOT/node_modules/ffmpeg-static")"
  FFPROBE_STATIC="$(node -e 'process.stdout.write(require(process.argv[1]).path)' "$TOOLING_ROOT/node_modules/ffprobe-static")"
  cp "$FFMPEG_STATIC" "$RUNTIME_ROOT/bin/ffmpeg"
  cp "$FFPROBE_STATIC" "$RUNTIME_ROOT/bin/ffprobe"
  chmod +x "$RUNTIME_ROOT/bin/ffmpeg" "$RUNTIME_ROOT/bin/ffprobe"
else
  cp "$(command -v ffmpeg)" "$RUNTIME_ROOT/bin/ffmpeg"
  cp "$(command -v ffprobe)" "$RUNTIME_ROOT/bin/ffprobe"
  chmod +x "$RUNTIME_ROOT/bin/ffmpeg" "$RUNTIME_ROOT/bin/ffprobe"
fi

# A normal YouTube/Twitch/web page is not itself a media stream. Kick changed
# its VOD routes in July 2026 and the stable yt-dlp extractor still returns
# 404 for those URLs. Until upstream PR #17322 is merged, install its exact
# reviewed head instead of following a mutable branch. curl-cffi supplies the
# browser impersonation required by Kick's playback CDN.
if [ ! -f "$YTDLP_MARKER" ] || [ "$(cat "$YTDLP_MARKER" 2>/dev/null || true)" != "$YTDLP_KICK_REF" ]; then
  rm -rf "$YTDLP_PYTHON_ROOT"
  python3 -m pip install \
    --target "$YTDLP_PYTHON_ROOT" \
    --disable-pip-version-check \
    --no-cache-dir \
    "yt-dlp[default,curl-cffi] @ git+https://github.com/doe1080/yt-dlp.git@$YTDLP_KICK_REF"
  printf '%s' "$YTDLP_KICK_REF" > "$YTDLP_MARKER"
else
  echo "[render-native] reusing pinned Kick-compatible yt-dlp."
fi

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"' \
  'PYTHON_ROOT="$(cd "$SCRIPT_DIR/../yt-dlp-python" && pwd)"' \
  'PYTHONPATH="$PYTHON_ROOT${PYTHONPATH:+:$PYTHONPATH}" exec python3 -m yt_dlp "$@"' \
  > "$RUNTIME_ROOT/bin/yt-dlp"
chmod +x "$RUNTIME_ROOT/bin/yt-dlp"

export PATH="$RUNTIME_ROOT/bin:$PATH"
"$RUNTIME_ROOT/bin/ffmpeg" -version >/dev/null
"$RUNTIME_ROOT/bin/ffprobe" -version >/dev/null
"$RUNTIME_ROOT/bin/yt-dlp" --version >/dev/null

# Reuse heavy native tools from Render's build cache whenever possible.
NEED_CMAKE=false
if [ ! -x "$RUNTIME_ROOT/bin/whisper-cli" ] || [ ! -s "$RUNTIME_ROOT/models/ggml-tiny.bin" ]; then
  NEED_CMAKE=true
fi
if [ ! -x "$ESPEAK_PREFIX/bin/espeak-ng" ] || [ ! -d "$ESPEAK_PREFIX/share/espeak-ng-data" ]; then
  NEED_CMAKE=true
fi

if [ "$NEED_CMAKE" = "true" ]; then
  if ! command -v cmake >/dev/null 2>&1; then
    python3 -m pip install --user --break-system-packages --disable-pip-version-check --no-cache-dir cmake
    export PATH="$(python3 -m site --user-base)/bin:$PATH"
  fi
  command -v cmake >/dev/null
fi

if [ ! -x "$RUNTIME_ROOT/bin/whisper-cli" ] || [ ! -s "$RUNTIME_ROOT/models/ggml-tiny.bin" ]; then
  rm -rf "$WHISPER_SRC"
  git clone --filter=blob:none --no-checkout https://github.com/ggml-org/whisper.cpp.git "$WHISPER_SRC"
  cd "$WHISPER_SRC"
  git fetch --depth 1 origin "$WHISPER_COMMIT"
  git checkout --detach FETCH_HEAD
  cmake -S . -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON
  cmake --build build --config Release --target whisper-cli --parallel 2
  cp build/bin/whisper-cli "$RUNTIME_ROOT/bin/whisper-cli"
  chmod +x "$RUNTIME_ROOT/bin/whisper-cli"

  curl --fail --location --retry 3 \
    "$WHISPER_MODEL_URL" \
    --output "$RUNTIME_ROOT/models/ggml-tiny.bin"
else
  echo "[render-native] reusing cached whisper.cpp and model."
fi
test -s "$RUNTIME_ROOT/models/ggml-tiny.bin"

# News Mode needs real narration. Reuse the pinned cached build when available.
if [ ! -x "$ESPEAK_PREFIX/bin/espeak-ng" ] || [ ! -d "$ESPEAK_PREFIX/share/espeak-ng-data" ]; then
  rm -rf "$ESPEAK_SRC" "$ESPEAK_PREFIX"
  git clone --filter=blob:none --no-checkout https://github.com/espeak-ng/espeak-ng.git "$ESPEAK_SRC"
  cd "$ESPEAK_SRC"
  git fetch --depth 1 origin "$ESPEAK_COMMIT"
  git checkout --detach FETCH_HEAD
  cmake -S . -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$ESPEAK_PREFIX" \
    -DBUILD_SHARED_LIBS=OFF \
    -DUSE_LIBPCAUDIO=OFF \
    -DUSE_SONIC=OFF
  cmake --build build --config Release --parallel 2
  cmake --build build --config Release --target data --parallel 1
  cmake --install build
else
  echo "[render-native] reusing cached eSpeak NG."
fi

test -x "$ESPEAK_PREFIX/bin/espeak-ng"
test -d "$ESPEAK_PREFIX/share/espeak-ng-data"
ESPEAK_DATA_PATH="$ESPEAK_PREFIX/share/espeak-ng-data" \
  "$ESPEAK_PREFIX/bin/espeak-ng" --version >/dev/null

cd "$ROOT"
npm ci --include=dev
# Production bootstrap belongs to the running service, not to build-time tests.
# Keep tests deterministic even when Render injects runtime environment values.
CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS=false \
CLIPFORGE_REDIS_URL= \
REDIS_URL= \
npm run build
npm prune --omit=dev
rm -rf "$TOOLING_ROOT"

"$RUNTIME_ROOT/bin/whisper-cli" --help >/dev/null 2>&1 || true
"$RUNTIME_ROOT/bin/ffmpeg" -version >/dev/null
"$RUNTIME_ROOT/bin/ffprobe" -version >/dev/null
"$RUNTIME_ROOT/bin/yt-dlp" --version >/dev/null
ESPEAK_DATA_PATH="$ESPEAK_PREFIX/share/espeak-ng-data" \
  "$ESPEAK_PREFIX/bin/espeak-ng" --version >/dev/null

echo "[render-native] eSpeak NG bundled; News Mode local narration is available."
echo "[render-native] yt-dlp bundled; supported normal video URLs can be imported."
echo "[render-native] build completed with FFmpeg, FFprobe, whisper.cpp tiny model, yt-dlp and eSpeak NG."
