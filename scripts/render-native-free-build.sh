#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="$ROOT/.runtime"
WHISPER_SRC="$RUNTIME_ROOT/src/whisper.cpp"
WHISPER_COMMIT="d09f61a708f3487afa956ff578e60eae5e7a233c"
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"

cd "$ROOT"
mkdir -p "$RUNTIME_ROOT/bin" "$RUNTIME_ROOT/models" "$RUNTIME_ROOT/src"

# Render native Node runtimes already provide FFmpeg/FFprobe. Keep this check
# explicit so a platform image change fails the deploy instead of producing a
# half-working media runtime.
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null

# cmake is not guaranteed by Render's native runtime. Install its Python wheel
# only for the build if necessary; the built whisper-cli is copied into the
# deploy artifact and does not require cmake at runtime.
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

cd "$ROOT"
npm ci --include=dev
npm run build
npm prune --omit=dev

"$RUNTIME_ROOT/bin/whisper-cli" --help >/dev/null 2>&1 || true

if command -v espeak-ng >/dev/null 2>&1; then
  echo "[render-native] espeak-ng detected; News Mode local narration is available."
else
  echo "[render-native] espeak-ng is not present in the native runtime; core clip processing remains available."
fi

echo "[render-native] build completed with FFmpeg, FFprobe and whisper.cpp tiny model."
