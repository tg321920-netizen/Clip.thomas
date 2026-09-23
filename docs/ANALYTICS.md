# Analytics

ClipForge stores analytics as immutable metric snapshots per publication and platform.

Current local contract: `views`, `likes`, `comments`, `shares`, `watchTime`, `retention` (0–100) and `followersGained`, plus `capturedAt`.

This block deliberately does **not** fetch data from TikTok, YouTube or Facebook yet. Provider fetching requires official OAuth credentials and secure token storage. Keeping ingestion separate lets provider adapters be added later without putting secrets in JSON files or the frontend.
