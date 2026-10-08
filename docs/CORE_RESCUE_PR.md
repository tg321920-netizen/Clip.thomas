## Problem and behavior

Android uploads previously sent the entire file in one request and restarted after a disconnect. Uploads now use verified 2 MiB fragments, retain completed fragments for retries, reconstruct the original atomically and enqueue server ingestion. Disk writes handle partial writes explicitly.

The mobile home screen exposes three connected tools: a six-scene narrated story renderer, complete video silence editing, and distinct clip extraction from real Whisper transcripts. Jobs persist their stages, errors, attempts and validation evidence. Closing the browser does not stop the worker. READY requires actual MP4 files that pass FFprobe and complete FFmpeg decoding.

Render fixes normalize frame rates and timestamps, apply subtitles relative to the chosen clip, bound decoder memory, retain original uploads and use atomic final outputs. Clip selection considers complete sentences, measured audio energy and duplicate content. Downloads support HTTP Range and attachment headers.

Automatic publishing is disabled in code and removed from both supervisors.

## Validation

CI runs lint, TypeScript checks, the unit/integration suite and a Next.js production build. Real acceptance tests reconstruct a 27 MiB upload over HTTP, generate a 60-second Spanish story with six original images, shorten an actual spoken video, transcribe an original fictional 20-minute recording with Whisper and render three different 90–180 second clips. OCR checks burned captions at their measured times. Chromium uses Pixel 5 emulation to submit jobs, close the page during processing, play MP4s and download their actual bytes. Process termination/recovery and an HTTP-server restart test persistence on retained storage.

Media files, screenshots and JSON evidence are attached to the GitHub Actions run. Earlier server acceptance evidence is available at https://github.com/tg321920-netizen/Clip.thomas/actions/runs/37800544784 . The checks associated with this PR verify the final commit.

## Deployment limits

This branch has not changed production. A physical Android device and the deployed Render/Vercel path still need verification. Render's existing /tmp storage survives an application restart but does not guarantee preservation after an instance replacement. Durable production storage needs the actual existing infrastructure inspected; no paid disk or new subscription has been enabled.

The free local script covers the original Maya example and complete user-supplied narratives. Other automatic topics require an authorized script provider; custom scenes require user images or an authorized image provider. No external paid API is called by default. eSpeak narration and Whisper tiny are free local options with quality limits; transcript corrections remain available through the existing subtitle editor.
