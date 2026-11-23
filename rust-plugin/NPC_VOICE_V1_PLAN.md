# NPC Studio V1 — in-game voice implementation plan

Status: **architecture established, implementation and Rust-server verification pending**.

## Requirement

When a player presses E on a placed NPC, the current dialogue node opens and its recorded voice line plays from that NPC in Rust. On a choice, the next node's voice line replaces the previous one. No proximity-triggered conversations. The author uploads an MP3, WAV, or OGG in the resil.me editor. No third-party Rust plugins, paid libraries, or Codefling dependencies.

## Why the current implementation does not play audio

The web API stores original audio bytes and returns audio URLs. The Rust plugin reads the node's `audio` field but never uses it. Rust's client cannot be told to play an arbitrary remote MP3 as a normal prefab sound effect. A working approach is to deliver encoded voice frames through Rust's native proximity voice channel, associated with the NPC's network entity ID. The existing NPC is a `BasePlayer`, which is suitable for a voice source, but the precise packet format and current Rust server APIs **must be tested**, not assumed.

## First-party architecture

1. **Upload:** Website validates and stores original audio as it does today.
2. **Prepare:** Convert the uploaded audio to mono 48-kHz PCM and encode Opus voice frames (20-ms frames as the initial candidate), using a first-party service pipeline with an open-source codec/FFmpeg executable as a build-time tool if permitted. The runtime plugin must not depend on a third-party Rust plugin. The output is a versioned manifest of timestamped binary packets, not an MP3 URL.
3. **Distribute:** Provide an authenticated `/api/devtools/npcs/runtime/audio/:id/frames` endpoint, using the same runtime bearer token as the definitions endpoint. Include format version, sample rate, frame duration, packet encoding, total duration, and bounded frame count. Add response-size and access controls. Keep the existing admin audio preview endpoint.
4. **Cache:** During explicit `/npcstudio sync`, download and validate only audio referenced by definitions, cache packets locally, and retain the previous cache on failure. No automatic refresh of placed NPCs.
5. **Play:** On E-to-talk, send the node's packet sequence to the interacting player using Rust's native voice packet path, with the NPC network ID as source. Pace packets at the encoded frame interval; stop immediately on choice, close, disconnect, death, or NPC removal. Use a generation token per conversation to prevent old timers leaking into new dialogue.
6. **Scope:** Begin with *listener-only* voice to match an E-initiated private dialogue. Optionally add nearby-listener voice later, once the format is verified.
7. **Compatibility gate:** On Shockbyte, test one short, known-good Opus frame sequence with the actual current Rust server build. Verify that it compiles, produces audible voice, originates at the NPC, and stops on close. **Do not build a large transcoding pipeline until this gate passes.**

## Acceptance tests

- A recorded line assigned to a start node plays when E is pressed.
- A choice transitions to the next node and plays the correct new recording.
- Rapid choices, close/reopen, player disconnect, and NPC removal do not leave sound playing.
- No voice is emitted merely by approaching an NPC.
- An NPC with no audio remains a valid text-only dialogue.
- Invalid or unavailable audio does not block the NPC's text interaction.
- No new audio automatically applies to already placed NPCs until the owner applies an update.
- The system runs without any third-party Rust plugin.

## Current blockers

- Exact current Rust voice packet serialization and client expectations have not been verified against Shockbyte.
- A server-side Opus encoder/transcoder packaging strategy for Railway has not been verified.
- No live server compile or playback test has occurred.

**Do not mark voice complete until the compatibility gate and acceptance tests pass.**
