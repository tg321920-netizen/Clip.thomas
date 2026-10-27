"""Offline English → Spanish for an explicitly installed CTranslate2 model.

No network, automatic installation, credentials, audio replacement or text logs.
"""
import hashlib
import json
from pathlib import Path
import sys


def main():
    import ctranslate2
    import sentencepiece

    payload = json.loads(sys.stdin.buffer.read(520_001))
    texts = payload.get("texts")
    if payload.get("source") != "en" or payload.get("target") != "es":
        raise ValueError("UNSUPPORTED_LANGUAGE_PAIR")
    if not isinstance(texts, list) or not 1 <= len(texts) <= 500:
        raise ValueError("INVALID_TEXT_COUNT")
    if any(not isinstance(text, str) or not text.strip() or len(text) > 1000 for text in texts):
        raise ValueError("INVALID_TEXT")
    root = Path(sys.argv[1]).resolve(strict=True)
    metadata = json.loads((root / "metadata.json").read_text())
    if metadata.get("from_code") != "en" or metadata.get("to_code") != "es":
        raise ValueError("MODEL_LANGUAGE_MISMATCH")
    model_format = metadata.get("format", "argos-ct2-v1")
    if model_format not in ("argos-ct2-v1", "marian-ct2-v1"):
        raise ValueError("UNSUPPORTED_MODEL_FORMAT")
    if model_format == "marian-ct2-v1":
        allowed = {"source.spm", "target.spm", "model/model.bin", "model/config.json", "model/shared_vocabulary.json"}
        files = metadata.get("files", {})
        if set(files) != allowed:
            raise ValueError("MODEL_MANIFEST_INCOMPLETE")
        for name, expected in files.items():
            with (root / name).open("rb") as asset:
                if hashlib.file_digest(asset, "sha256").hexdigest() != expected:
                    raise ValueError("MODEL_INTEGRITY_FAILED")
    source_tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(root / ("source.spm" if model_format == "marian-ct2-v1" else "sentencepiece.model")))
    target_tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(root / "target.spm")) if model_format == "marian-ct2-v1" else source_tokenizer
    engine = ctranslate2.Translator(str(root / "model"), device="cpu", compute_type="int8", inter_threads=1, intra_threads=1)
    output = []
    for start in range(0, len(texts), 8):
        batch = [source_tokenizer.encode(text, out_type=str) + (["</s>"] if model_format == "marian-ct2-v1" else []) for text in texts[start:start + 8]]
        if any(len(tokens) > 400 for tokens in batch):
            raise ValueError("TEXT_TOKEN_LIMIT")
        results = engine.translate_batch(batch, beam_size=4, max_decoding_length=500)
        output.extend(target_tokenizer.decode(result.hypotheses[0]) for result in results)
    digest = hashlib.sha256()
    with (root / "model" / "model.bin").open("rb") as model:
        for block in iter(lambda: model.read(1024 * 1024), b""):
            digest.update(block)
    json.dump({"translations": output, "modelSha256": digest.hexdigest(), "modelFormat": model_format,
               "modelId": metadata.get("model_id"), "modelRevision": metadata.get("revision"),
               "modelLicense": metadata.get("license")}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Source text and Python tracebacks never reach server logs.
        sys.stderr.write("LOCAL_TRANSLATION_FAILED\n")
        sys.exit(1)
