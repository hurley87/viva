---
status: accepted
---

# OpenAI Realtime over WebRTC for Session transport

Live Sessions run on OpenAI's Realtime API via `openai-agents-js` (`RealtimeAgent`/`RealtimeSession`, WebRTC). The alternative was a composed STT→LLM→TTS pipeline (or another realtime vendor), which is more portable and easier to pass through restrictive networks — but examiner *pressure* is the product, and pipeline latency makes the examiner feel non-adversarial. We chose interruption/VAD quality over portability. Consequences: vendor lock-in on the session path, and Student voice transits OpenAI US servers under standard ≈30-day API retention, disclosed when the deployment setting is confirmed. A safe, secure test setting is chosen at deployment; network/policy verification is not a build-blocking workstream.
