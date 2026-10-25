#!/usr/bin/env python3
"""Local-only Spanish neural speech adapter. Models are provisioned separately."""
import argparse
import sys
import wave
import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro
ort.disable_telemetry_events()

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--voices", required=True)
parser.add_argument("--output_file", required=True)
parser.add_argument("--length_scale", type=float, default=1.1)
parser.add_argument("--sentence_silence", type=float, default=0.18)
parser.add_argument("--quiet", action="store_true")
args = parser.parse_args()
text = sys.stdin.read(50000).strip()
if not text or len(text) > 12000 or not 0.8 <= args.length_scale <= 1.5:
    raise SystemExit("Invalid narration text or pacing")
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
session = ort.InferenceSession(args.model, sess_options=options, providers=["CPUExecutionProvider"])
voice = Kokoro.from_session(session, args.voices)
samples, sample_rate = voice.create(text, voice="ef_dora", speed=1.0 / args.length_scale, lang="es", sentence_pause=args.sentence_silence)
samples = np.concatenate([samples, np.zeros(int(sample_rate * args.sentence_silence), dtype=np.float32)])
with wave.open(args.output_file, "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(sample_rate)
    output.writeframes((np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes())
