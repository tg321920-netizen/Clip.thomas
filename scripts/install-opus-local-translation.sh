#!/usr/bin/env bash
# Explicit optional installation only. Never called by the web app or Render.
set -euo pipefail
translation_root="${1:-/workspace/clipforge-tools}"
mkdir -p "$translation_root"
python3 -m venv "$translation_root/translation-opus-venv"
translation_python="$translation_root/translation-opus-venv/bin/python"
"$translation_python" -m pip install --disable-pip-version-check torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
"$translation_python" -m pip install --disable-pip-version-check ctranslate2==4.6.3 sentencepiece==0.2.1 transformers==4.57.1 safetensors==0.6.2
OMP_NUM_THREADS=1 "$translation_python" scripts/install-opus-local-translation.py "$translation_root"
