# resil.me NPC Studio — Rust runtime V1

## Implementation status (November 2026)

The implementation branch is `npc-studio-full-v1`. The website editor, authenticated NPC manifest, definition synchronization, manual apply, NPC placement, E-to-talk dialogue, and first-party audio conversion/playback code are present. Uploaded audio is converted by FFmpeg to 20-ms Opus packets; the Rust plugin fetches those packets using the runtime token and sends them to the interacting client as native Rust voice data. Optional in-game push-to-talk recording provides an alternate source via `clip:<id>`.

**No end-to-end testing or Shockbyte installation has occurred.** Rust packet serialization, Opus compatibility, The current Oxide microphone hook was updated to use ArraySegment<byte> and the NetworkableId writer conversion was corrected in source; exact target-build compilation, website build, voice wire format, and actual audio playback remain unverified. These are release gates, not completed functionality. Source-level hardening and automated voice conversion tests are included; live testing remains blocked without a staging Rust server and a runnable website build.

## Audio integration

- Website upload: `POST /api/devtools/npcs/audio` accepts MP3/WAV/OGG, stores the original and its bounded Opus packets.
- Website preview: `GET /api/devtools/npcs/audio/:id` returns the original to an authenticated site administrator.
- Rust voice: `GET /api/devtools/npcs/runtime/audio/:id/frames` returns Opus packet JSON to the runtime bearer token only.
- Node audio reference: `/api/devtools/npcs/audio/voice-<id>` for uploads, or `clip:<id>` for in-game recorded voice.
- Runtime: E opens dialogue; each node can play its own audio. Choice/close interrupts previous playback. The website audio packets are fetched on first use and cached in memory; existing placed NPC definition snapshots are not updated by sync alone.
- FFmpeg is already included in the app Dockerfile; voice conversion has a 20-second process watchdog and a 30-second output limit.

## Release testing (deferred)

1. Verify website TypeScript build and audio upload conversion, including Opus packet decode.
2. Compile the Rust plugin on the actual current Oxide build; adjust voice callback and packet writer API if necessary.
3. Verify a spoken line actually plays from an NPC and that branching interrupts playback.
4. Verify placement, persistence, invulnerability, equipment, and manual updates.
5. Verify runtime token configuration and offline/failed network behavior.

## Configuration and secrets

1. In Railway for the `zipline` service, configure `RESIL_NPC_RUNTIME_TOKEN` to a randomly generated secret of at least 32 characters. Keep it private.
2. On the staging Rust server, place `RENPCStudio.cs` in `oxide/plugins/`. After Oxide creates `oxide/config/RENPCStudio.json`, set `StudioUrl` to `https://resil.me`, `RuntimeToken` to **the same secret**, and `OwnerSteamIds` to the authorized Steam64 administrator IDs. Never commit tokens to GitHub or paste them in public logs.
3. Reload with `oxide.reload RENPCStudio`. Inspect Oxide compiler errors and the Rust console. The plugin has not been verified to compile on the current server build.
4. From an authorized administrator account, use `/npcstudio sync` to import published NPC definitions. This does not change already placed NPCs.
5. Run `/npcstudio definitions`, then `/npcstudio spawn <definition-id>` while standing at the location and facing the intended direction. Review the **text-only** location/yaw preview; use `/npcstudio confirm` or `/npcstudio cancel`.
6. When a web definition changes, `/npcstudio sync` imports it; `/npcstudio apply` explicitly replaces affected placed instances. Existing placements retain pinned snapshots until apply. Keep a backup of `oxide/data/RENPCStudio.json` and `oxide/data/RENPCStudio_Definitions.json` before updating.

## API contract

`GET /api/devtools/npcs/runtime` with `Authorization: Bearer <token>` returns a versioned NPC manifest. `GET /api/devtools/npcs/runtime/audio/:id` serves audio bytes to authorized runtime callers. Website voice conversion and native voice packet replay are implemented in source, but in-game playback has not been verified.

## Known limitations and release gates

- **Compile gate:** Compile the exact canonical plugin against the target Oxide/uMod Rust build; resolve API signatures and warnings.
- **Placement gate:** Verify civilian spawn, network registration, owner-only access, orientation, restart persistence, removal, and killable/invulnerable settings.
- **Dialogue gate:** Verify E-to-talk, all choice branches, disconnect/close cleanup, and that old placements do not change after sync without apply.
- **Audio gate:** Determine a supported, tested Rust client playback path for custom recorded voices, including supported format, distribution, proximity, interruption, and cleanup. The native voice packet mechanism is implemented but has not been validated on the target Rust build.
- **Failure gate:** Test unreachable backend, invalid/expired token, malformed manifest, failed replacement spawn, and rollback. Do not run on the production Rust server before staging tests.
- **Editor/runtime mismatch:** Conditional choices are explicitly rejected at sync, not silently exposed. Only four choices are rendered per node by the current in-game UI. The first dialogue node is treated as the entry point.

## Scope

All NPC Studio functionality is first-party. No Codefling plugin or externally supplied NPC runtime is used. Web tools are site-admin-only; notifications about available definition updates belong in the authenticated web UI, not in Rust.
