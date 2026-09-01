# Synchronized Visual Examiner

**Status:** Idea for later exploration; not part of the Viva MVP.

## Idea

Give Viva's real-time voice examiner a synchronized visual presence. The visual could respond to session state—listening, thinking, speaking, being interrupted, and ending—without changing the examiner's role or turning the Session into an explainer video.

This idea was prompted by a generative-video classroom that lets someone request short animated explainers and queue follow-up questions while watching them. That interaction pattern is adjacent to Viva, but its purpose is different:

- A generative-video classroom follows `ask → watch an explanation → ask a follow-up`.
- Viva follows `respond → get challenged → defend the reasoning → receive an Assessment`.

Viva should preserve the second loop. During a Session, the examiner must probe the Student without supplying the Student's position (INV-1).

## Forms of synchronization

### 1. Presence synchronization

This is the strongest near-term fit. A fixed character, lightweight animation, or abstract visual presence follows real-time Session events:

- listening;
- thinking;
- speaking;
- interrupted;
- warning that time is nearly over; and
- ending the Session.

The Realtime audio remains the source of truth. The visual communicates conversational state rather than generating instructional content.

### 2. Turn-based generated video

A future Session could pause after an examiner prompt, generate and play a short scenario clip, and then resume the conversation. Fast video models make this increasingly plausible: fal reports that H3 Max can generate a five-second clip in roughly three seconds.

This would be synchronized turn-taking, not continuous real-time video. It would also introduce variable latency and inconsistent generated material between Students.

### 3. Continuous lip-synced examiner video

This is not a good fit for the current H3 Max API. It returns complete 5–15 second video files from a generation request rather than streaming frames alongside an unpredictable conversation. Because dialogue and lip sync can be generated inside the clip, synchronizing a separately generated OpenAI Realtime examiner response would also be awkward.

A continuous talking examiner would require a purpose-built streaming-avatar or real-time rendering system. It should not be necessary to validate the underlying Viva experience.

## Recommendation

1. Keep generative video out of the MVP. The current live screen should remain focused on voice, the countdown timer, and examiner captions.
2. If greater social presence is needed, test a lightweight visual examiner driven by Realtime events. Do not make it semantically generative.
3. Later, consider Teacher-approved, pre-generated scenario clips as versioned Assignment stimuli. Every Student should receive the same clip under the same Assignment version.
4. Do not generate explanatory video from a Student's answers during an assessed Session. It could feed the Student's position back to them, weaken INV-1, and make examination conditions inconsistent.

## Product boundary

The relevant opportunity is **a real-time voice examiner with synchronized visual presence**, not **an on-demand generative-video teacher**.

## Open questions for a later experiment

- Does a visual examiner improve engagement or merely add distraction?
- Should Students be able to disable it for accessibility or preference?
- Can state changes follow Realtime events with no perceptible lag?
- If video becomes Assignment material, how is it versioned, captioned, and reviewed by the Teacher?
- Does any generated or uploaded media create new retention, consent, or institutional-policy requirements?

## References

- [Viva PRD](../prd.md), especially INV-1 and the Session shape.
- [fal: Introducing H3 Max](https://fal.ai/learn/devs/introducing-h3-max-by-fal)
- [fal: H3 Max text-to-video API](https://fal.ai/models/minimax/h3-max/text-to-video/api)
