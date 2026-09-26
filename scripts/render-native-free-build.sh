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
  # The start command intentionally points at .runtime/bin. A host binary may
  # exist during the build but not at that path in the deployed artifact, so
  # always copy it into the runtime bundle instead of assuming PATH will match.
  cp "$(command -v ffmpeg)" "$RUNTIME_ROOT/bin/ffmpeg"
  cp "$(command -v ffprobe)" "$RUNTIME_ROOT/bin/ffprobe"
  chmod +x "$RUNTIME_ROOT/bin/ffmpeg" "$RUNTIME_ROOT/bin/ffprobe"
fi

export PATH="$RUNTIME_ROOT/bin:$PATH"
"$RUNTIME_ROOT/bin/ffmpeg" -version >/dev/null
"$RUNTIME_ROOT/bin/ffprobe" -version >/dev/null

# cmake is not guaranteed by Render's native runtime. Install its Python wheel
# only for the build if necessary; the built media tools are copied into the
# deploy artifact and do not require cmake at runtime.
if ! command -v cmake >/dev/null 2>&1; then
  python3 -m pip install --user --break-system-packages --disable-pip-version-check --no-cache-dir cmake
  export PATH="$(python3 -m site --user-base)/bin:$PATH"
fi
command -v cmake >/dev/null

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
test -s "$RUNTIME_ROOT/models/ggml-tiny.bin"

# News Mode needs real narration. Bundle a pinned eSpeak NG build instead of
# depending on packages installed in Render's host image or a paid TTS API.
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

test -x "$ESPEAK_PREFIX/bin/espeak-ng"
test -d "$ESPEAK_PREFIX/share/espeak-ng-data"
ESPEAK_DATA_PATH="$ESPEAK_PREFIX/share/espeak-ng-data" \
  "$ESPEAK_PREFIX/bin/espeak-ng" --version >/dev/null

cd "$ROOT"
npm ci --include=dev
npm run build
npm prune --omit=dev
rm -rf "$TOOLING_ROOT"

"$RUNTIME_ROOT/bin/whisper-cli" --help >/dev/null 2>&1 || true
"$RUNTIME_ROOT/bin/ffmpeg" -version >/dev/null
"$RUNTIME_ROOT/bin/ffprobe" -version >/dev/null
ESPEAK_DATA_PATH="$ESPEAK_PREFIX/share/espeak-ng-data" \
  "$ESPEAK_PREFIX/bin/espeak-ng" --version >/dev/null

echo "[render-native] eSpeak NG bundled; News Mode local narration is available."
echo "[render-native] build completed with FFmpeg, FFprobe, whisper.cpp tiny model and eSpeak NG."
