#!/usr/bin/env bash
set -euo pipefail
TASK_WHISPER_ROOT="/tmp/clipforge-whisper"
mkdir -p "$TASK_WHISPER_ROOT"
git clone --filter=blob:none --no-checkout https://github.com/ggml-org/whisper.cpp.git "$TASK_WHISPER_ROOT/src"
git -C "$TASK_WHISPER_ROOT/src" fetch --depth 1 origin d09f61a708f3487afa956ff578e60eae5e7a233c
git -C "$TASK_WHISPER_ROOT/src" checkout --detach FETCH_HEAD
cmake -S "$TASK_WHISPER_ROOT/src" -B "$TASK_WHISPER_ROOT/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
cmake --build "$TASK_WHISPER_ROOT/build" --target whisper-cli --parallel 2
curl --fail --location --retry 3 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin --output "$TASK_WHISPER_ROOT/ggml-tiny.bin"
test -s "$TASK_WHISPER_ROOT/ggml-tiny.bin"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "WHISPER_PROVIDER=cpp" >> "$GITHUB_ENV"
  echo "WHISPER_CPP_COMMAND=$TASK_WHISPER_ROOT/build/bin/whisper-cli" >> "$GITHUB_ENV"
  echo "WHISPER_CPP_MODEL_PATH=$TASK_WHISPER_ROOT/ggml-tiny.bin" >> "$GITHUB_ENV"
  echo "WHISPER_CPP_THREADS=2" >> "$GITHUB_ENV"
  echo "WHISPER_LANGUAGE=es" >> "$GITHUB_ENV"
fi
