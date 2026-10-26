#!/usr/bin/env bash
# Explicit, optional CPU setup. Never runs from a web request or deploy blueprint.
set -euo pipefail
translation_root="${1:-/workspace/clipforge-tools}"
mkdir -p "$translation_root"
if [ ! -x "$translation_root/translation-venv/bin/python" ]; then
  python3 -m venv "$translation_root/translation-venv"
fi
translation_python="$translation_root/translation-venv/bin/python"
if ! "$translation_python" -c 'import importlib.metadata as m; assert m.version("ctranslate2")=="4.6.3"; assert m.version("sentencepiece")=="0.2.1"' >/dev/null 2>&1; then
  "$translation_python" -m pip install --disable-pip-version-check ctranslate2==4.6.3 sentencepiece==0.2.1
fi
translation_archive="$translation_root/translate-en_es-1_0.argosmodel"
if [ ! -f "$translation_archive" ]; then
  curl --fail --location --retry 2 --max-time 120 https://argos-net.com/v1/translate-en_es-1_0.argosmodel -o "$translation_archive.download"
  mv "$translation_archive.download" "$translation_archive"
fi
"$translation_python" - "$translation_root" <<'PY'
import hashlib
from pathlib import Path
import sys
import zipfile
root = Path(sys.argv[1]).resolve()
archive = root / "translate-en_es-1_0.argosmodel"
if hashlib.sha256(archive.read_bytes()).hexdigest() != "d698d0ef87ad70d5d184b7fa6965905bf4368f09a2bb9ffb165a79bac96af0c4":
    raise RuntimeError("MODEL_ARCHIVE_INTEGRITY_FAILED")
target = root / "translation-model-en-es"
with zipfile.ZipFile(archive) as package:
    for name in ["model/model.bin", "model/shared_vocabulary.txt", "sentencepiece.model", "metadata.json", "README.md"]:
        output = target / name
        expected = package.read("en_es/" + name)
        if output.exists():
            if output.read_bytes() != expected:
                raise RuntimeError("EXISTING_MODEL_DIFFERS_PRESERVED")
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(expected)
if hashlib.sha256((target / "model/model.bin").read_bytes()).hexdigest() != "d5771f823c9dd7eedcf9367c116aede65613a194f761a81826351e2bccb194c4":
    raise RuntimeError("MODEL_INTEGRITY_FAILED")
print("Local translation installed; configure CLIPFORGE_TRANSLATION_PYTHON and CLIPFORGE_TRANSLATION_MODEL_PATH on the processing server. No service started.")
PY
