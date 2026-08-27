# Transcript capture and server-enforced time-box

Type: research
Status: resolved

## Question

For `openai-agents-js` (`RealtimeAgent`/`RealtimeSession` over WebRTC), surface the facts the build waits on:

1. How are transcripts of **both** Student and Examiner turns exposed (events/config)? What must be enabled for user-side speech transcription, and which transcription model options exist?
2. Known reliability caveats — the transcript is the *sole* Session record (ADR-0001), so missing/partial turns are a product defect. Ordering, interruption handling, dropped finals.
3. Sane persistence path into Convex given the browser holds the WebRTC leg: client-streamed writes vs. end-of-session flush vs. server-side mirroring; what survives a tab crash.
4. Server-enforced 15-min time-box options (prd.md §INV-4 build note): ephemeral tokens only gate connection start (~1-min TTL) and the platform cap is 60 min. What can our server actually do to end/invalidate a session at 15:00, and what's the fallback if only the client can hang up?

Cite current docs (openai.github.io/openai-agents-js, platform.openai.com/docs/guides/realtime).

## Answer

Researched 2026-08-26 against openai.github.io/openai-agents-js (SDK docs + source on `openai/openai-agents-js` main) and developers.openai.com (platform.openai.com now 301-redirects there).

### 1. Transcript capture (both sides)

- **History API.** `RealtimeSession` maintains `session.history` (a snapshot of user messages, assistant output, tool calls, and truncation state) and emits `history_updated` (fires on *any* history change, whole new history in the payload) and `history_added` (fires when a new item is appended). `session.updateHistory(...)` writes back. Source: https://openai.github.io/openai-agents-js/guides/voice-agents/build/ and `packages/agents-realtime/src/realtimeSession.ts` (https://raw.githubusercontent.com/openai/openai-agents-js/main/packages/agents-realtime/src/realtimeSession.ts).
- **Assistant (Examiner) speech** is transcribed natively as part of audio output: raw `response.output_audio_transcript.delta` / `.done` transport events, surfaced into history items and via `agent_end` (includes the text output). Raw events are observable via the session's `transport_event` passthrough. Source: build guide + `RealtimeSessionEventTypes` in the SDK source above.
- **User (Student) speech is NOT transcribed unless enabled.** Config path in session config: `audio.input.transcription` (the SDK also historically exposed `inputAudioTranscription` on `RealtimeSessionConfig`; the current docs use `audio.input.transcription`). Current documented models: `gpt-live-transcribe` (recommended; low-latency streaming, tunable `delay`: minimal/low/medium/high/xhigh) and `gpt-transcribe` (transcribes after a committed turn); both accept `prompt`, `keywords`, `languages`. Source: https://developers.openai.com/api/docs/guides/realtime-transcription and https://openai.github.io/openai-agents-js/guides/voice-agents/build/. The older model names (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`) are no longer listed in the current transcription guide; whether they are still accepted is UNCONFIRMED.
- **User transcription events** (raw, via `transport_event`): `conversation.item.input_audio_transcription.delta`, `.completed`, `.failed`. Source: https://developers.openai.com/api/docs/guides/realtime-transcription and https://developers.openai.com/api/docs/api-reference/realtime-server-events.

### 2. Reliability caveats

- **User transcription is a separate, best-effort ASR pass**, not the model's own understanding: "Realtime API models accept audio natively, and thus input transcription is a separate process run on a separate ASR model. The transcript may diverge somewhat from the model's interpretation, and should be treated as a rough guide." (https://developers.openai.com/api/docs/api-reference/realtime-server-events, `conversation.item.input_audio_transcription.completed`).
- **Ordering is not guaranteed**: "Ordering between completion events from different speech turns isn't guaranteed." Reconcile by `item_id`, never by arrival order. (https://developers.openai.com/api/docs/guides/realtime-transcription).
- **Late/never finals**: user transcripts arrive asynchronously after the turn (often after the assistant has already started replying), and `conversation.item.input_audio_transcription.failed` can fire instead of `.completed` — i.e. a user turn can permanently lack a transcript. A faithful record must tolerate a turn whose text arrives late or never. (Same two URLs as above.)
- **Interruptions truncate assistant transcripts**: on barge-in the SDK truncates the assistant item; `conversation.item.truncate` "will cut the audio at a given place and remove the text transcript for the unplayed portion" — deliberately, because "the realtime model doesn't have enough information to precisely align transcript and audio." SDK-side: `audio_interrupted` event, `session.interrupt()`; responses truncated by interruption do not retain full final transcripts. So an interrupted Examiner turn is *supposed* to lose its unspoken tail — persist what history shows, flag the item as truncated. (https://developers.openai.com/api/docs/guides/realtime-conversations, https://openai.github.io/openai-agents-js/guides/voice-agents/build/).
- **Assembly guidance**: the SDK's `history_updated` already does the reconciliation (it merges `input_audio_transcription.completed` and truncation into an ordered item list keyed by item id). Persisting from history snapshots keyed by `itemId` — rather than concatenating raw deltas — is the sanctioned way to get an ordered, faithful transcript.

### 3. Persistence into Convex

Three realistic options:

- **(a) Incremental client writes** — on each `history_updated` (debounced) or `history_added`/transcription-completed, the browser calls a Convex mutation upserting items by `itemId` with the ordered history snapshot. Survives tab crash / network drop up to the last write; idempotent by construction (upsert on `itemId`, whole-history diff).
- **(b) End-of-session flush** — one write of `session.history` at hangup. Simplest, but a tab crash or dropped network loses the entire record. Disqualified given the transcript is the sole persisted artifact (ADR-0001).
- **(c) Server-side sideband mirror** — the platform DOES offer a server-visible leg for WebRTC: the SDP exchange returns a `Location` header containing a call id (`/v1/realtime/calls/rtc_...`); the SDK exposes it as `OpenAIRealtimeWebRTC.callId` ("The current call ID of the WebRTC connection", read from `sdpResponse.headers.get('Location')`). Your server can then open `wss://api.openai.com/v1/realtime?call_id=...` as a second connection to the *same* session to monitor server events and send `session.update`. (https://developers.openai.com/api/docs/guides/realtime-server-controls, https://raw.githubusercontent.com/openai/openai-agents-js/main/packages/agents-realtime/src/openaiRealtimeWebRtc.ts). Whether the sideband socket receives *all* transcription events is stated only as "monitor the session" / listen for server events in the guide — treat "sideband receives every transcription event" as UNCONFIRMED until tested. Practically, a long-lived WebSocket client fits neither Vercel serverless functions nor Convex actions for a 15-minute session, so a mirror would need a separate long-running worker.

**Recommendation: (a)**, incremental client writes keyed by `itemId`, driven by `history_updated`, debounced (~1s) plus an immediate flush on `audio_interrupted`, `agent_end`, and transcription-completed transport events, with a final flush on hangup. It is the only option that both survives client death and fits the Vercel/Convex runtime model. Optionally add (c) later as an audit layer.

### 4. Server-enforced 15:00 time-box

- **Ephemeral client secrets cannot time-box a session.** `POST /v1/realtime/client_secrets` takes `expires_after: { anchor: "created_at", seconds: 10–7200, default 600 }`, and expiry gates connection start only — "The session itself may continue after that time once started." No session-duration field exists at mint time. Platform hard cap: "The maximum duration of a Realtime session is 60 minutes." (https://developers.openai.com/api/docs/api-reference/realtime-sessions, https://developers.openai.com/api/docs/guides/realtime-conversations).
- **The server CAN kill a client-held WebRTC session.** `POST https://api.openai.com/v1/realtime/calls/{call_id}/hangup` — "End an active Realtime API call, whether it was initiated over SIP or WebRTC." (https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup, linked from https://developers.openai.com/api/docs/guides/realtime-server-controls). The `call_id` comes from the SDP response's `Location` header; in openai-agents-js it is `(session.transport as OpenAIRealtimeWebRTC).callId`. Caveat: with the default browser transport the *client* learns the call id and must report it to our server (a hostile client could withhold it); routing the SDP exchange through our own endpoint via the transport's `baseUrl`/`url` option would let the server capture `call_id` itself.
- **Recommended pattern (defense in depth):** (1) at session start, client reports `callId` → stored in Convex; a Convex scheduled function at start+15:00 calls the hangup endpoint with the server's API key; (2) client-side timer ends the session at 15:00 regardless (`session.close()` / transport disconnect) — the UX-quality path; (3) server refuses to persist transcript items and refuses grading for material past the cutoff (mutations compare against the server-recorded start time — INV-4 accounting lives server-side either way); (4) mint client secrets with short `expires_after` (e.g. 120s) so a token can't be hoarded to start late sessions. The 60-min platform cap remains only a backstop.

### Recommendation for the build

Enable `audio.input.transcription` (model `gpt-live-transcribe`) in the `RealtimeSession` config or user turns will have no transcript at all. Persist incrementally from the client on `history_updated`, upserting by `itemId` into Convex (debounced, with event-triggered and hangup flushes); tolerate late or missing user finals and mark truncated Examiner turns rather than treating them as loss. Store `transport.callId` at connect; enforce the 15:00 box three ways — Convex scheduled `POST /v1/realtime/calls/{call_id}/hangup`, a client-side hangup timer, and server-side refusal to persist/grade past start+15:00 computed from the server clock.
