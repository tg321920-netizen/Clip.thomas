#!/usr/bin/env bash
# Optional free local Kokoro tooling. No hosting, publication or secret changes.
set -euo pipefail
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'This installer is tested on Linux x86_64.' >&2; exit 1; }
clipforge_tools_dir="${CLIPFORGE_TOOLS_DIR:-/workspace/clipforge-tools}"
clipforge_repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$clipforge_tools_dir/downloads" "$clipforge_tools_dir/bin" "$clipforge_tools_dir/kokoro-models"
verified_download() {
  local destination="$1" expected="$2" url="$3"
  if [[ -f "$destination" ]] && [[ "$(sha256sum "$destination" | cut -d ' ' -f 1)" == "$expected" ]]; then return; fi
  local temporary
  temporary="$(mktemp "$clipforge_tools_dir/downloads/download-XXXXXX")"
  if ! curl --fail --location --silent --show-error --retry 2 --max-time 180 "$url" -o "$temporary"; then rm -f "$temporary"; return 1; fi
  if [[ "$(sha256sum "$temporary" | cut -d ' ' -f 1)" != "$expected" ]]; then rm -f "$temporary"; echo 'Artifact checksum mismatch; installation stopped.' >&2; return 1; fi
  mv "$temporary" "$destination"
}
verified_download "$clipforge_tools_dir/kokoro-models/kokoro-v1.0.int8.onnx" 6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
verified_download "$clipforge_tools_dir/kokoro-models/voices-v1.0.bin" bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
verified_download "$clipforge_tools_dir/ggml-base.bin" 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
python3 -m venv "$clipforge_tools_dir/kokoro"
"$clipforge_tools_dir/kokoro/bin/python" -m pip install --disable-pip-version-check --no-cache-dir -r "$clipforge_repo_dir/scripts/requirements-local-voice.txt"
printf '#!/usr/bin/env bash\nexec %q %q "$@"\n' "$clipforge_tools_dir/kokoro/bin/python" "$clipforge_repo_dir/scripts/kokoro-cli.py" > "$clipforge_tools_dir/bin/kokoro-narration"
chmod +x "$clipforge_tools_dir/bin/kokoro-narration"
"$clipforge_tools_dir/bin/kokoro-narration" --help >/dev/null
echo 'Verified local Kokoro, Spanish voice pack and Whisper base. Configure their paths on the media worker; nothing was deployed.'
