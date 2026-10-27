"""Explicit free model setup: pinned public assets, safetensors and CPU int8.

No secrets, paid API, production changes or runtime activation. CC BY 4.0 model
attribution is retained in README.md and metadata.json. Conversion needs more
RAM/disk than inference; this installer is not for the 512 MiB preview service.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request


def digest(filename):
    with filename.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    if sys.version_info < (3, 11):
        raise RuntimeError("Python 3.11 or newer required")
    manifest = json.loads((Path(__file__).parent / "models/opus-mt-tc-big-en-es.json").read_text())
    root = Path(sys.argv[1]).resolve()
    source = root / "opus-mt-tc-big-en-es-source"
    target = root / "translation-opus-en-es-8f4d492"
    # Preserve every previously installed model. Re-running only verifies it.
    if target.exists():
        metadata = json.loads((target / "metadata.json").read_text())
        if metadata.get("revision") != manifest["revision"]:
            raise RuntimeError("Existing model differs; preserved")
        for name, expected in metadata["files"].items():
            if digest(target / name) != expected:
                raise RuntimeError("Existing model integrity failed; preserved")
        print("Pinned model already installed and verified. No runtime changed.")
        return
    source.mkdir(parents=True, exist_ok=True)
    for name, expected in manifest["files"].items():
        output = source / name
        if not output.exists():
            request = "https://huggingface.co/" + manifest["modelId"] + "/resolve/" + manifest["revision"] + "/" + name
            partial = output.with_name(output.name + ".partial")
            with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as stream:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > expected["size"]:
                        raise RuntimeError("Model asset size exceeded")
                    stream.write(chunk)
            if partial.stat().st_size != expected["size"] or digest(partial) != expected["sha256"]:
                raise RuntimeError("Model download integrity failed")
            partial.rename(output)
        if output.stat().st_size != expected["size"] or digest(output) != expected["sha256"]:
            raise RuntimeError("Existing source differs; preserved")
    stage = Path(tempfile.mkdtemp(prefix=".translation-opus-", dir=root))
    # No pickle weights or remote Python code. Transformers resolves local files.
    env = {**os.environ, "HF_HUB_OFFLINE": "1", "OMP_NUM_THREADS": "1"}
    subprocess.run([str(Path(sys.executable).with_name("ct2-transformers-converter")),
                    "--model", str(source), "--output_dir", str(stage / "model"),
                    "--quantization", "int8"], check=True, env=env)
    for name in ["source.spm", "target.spm", "README.md"]:
        shutil.copyfile(source / name, stage / name)
    files = ["source.spm", "target.spm", "model/model.bin", "model/config.json", "model/shared_vocabulary.json"]
    metadata = {"format": "marian-ct2-v1", "from_code": "en", "to_code": "es",
                "model_id": manifest["modelId"], "revision": manifest["revision"],
                "license": manifest["license"], "files": {name: digest(stage / name) for name in files}}
    (stage / "metadata.json").write_text(json.dumps(metadata, indent=2))
    stage.rename(target)
    print("Pinned CPU model installed. Configure the private processing worker explicitly; no service started.")


if __name__ == "__main__":
    main()
