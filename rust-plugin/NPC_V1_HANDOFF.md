# NPC Studio V1 — release handoff (integration not yet verified)

## Source of truth
Development branch: `npc-studio-full-v1`. Production `trunk` is deliberately untouched because another resil.me workstream is active. Do not merge or deploy this branch without coordinating the shared website changes.

## Implemented
- Site-admin NPC library, folders, definition revisions, dialogue editor, clothing, voice upload and browser preview.
- Authenticated runtime definition manifest and authenticated 20-ms Opus packet endpoint.
- FFmpeg conversion of uploaded MP3/WAV/OGG to bounded Opus packets; original audio and packets persisted in PostgreSQL.
- Rust plugin: sync definitions, manually apply revisions, place/preview/rotate/remove NPCs, persist placements, E-to-talk, branching dialogue, non-repeatable completion, configurable killability, voice replay.
- Optional Rust microphone recording to server-local `clip:<id>` assets. This is independent of website uploads.
- Voice converter tests in `tests/npc-voice.test.ts` (added, not yet executed against this branch).

## Release blockers — not claimed complete
1. Build and test the website branch, including TypeScript, route authentication, and FFmpeg conversion tests.
2. Compile `rust-plugin/RENPCStudio.cs` against the exact Rust/Oxide version on the target server. Current Rust voice hook and packet writer APIs are not verified.
3. Confirm website-uploaded Opus frames are accepted by the Rust client as NPC voice. Packet framing, speaker network identity, and timing require a live client test.
4. Test NPC spawn, clothing, E interaction, all dialogue branches, voice interruption, death, restart persistence, and manual definition apply on a staging server.
5. Coordinate website integration with the other resil.me workstream before production merge. No production deployment is authorized by this handoff.

## Minimal integration procedure
1. In a staging Railway environment set `RESIL_NPC_RUNTIME_TOKEN` to a unique secret at least 32 characters long. Keep it out of commits and chat logs.
2. Run `npm test` and the repository's normal build/validation workflow with FFmpeg installed; inspect failures.
3. Install `RENPCStudio.cs` into the staging Rust server's `oxide/plugins/`. Inspect compilation errors before proceeding.
4. Set the plugin config's `StudioUrl`, `RuntimeToken` (same secret), and `OwnerSteamIds`; reload.
5. Create an NPC with a short uploaded spoken line at `/devtools/npcstudio`; save it. Run `/npcstudio sync`, `/npcstudio spawn <definition-id>`, and `/npcstudio confirm`.
6. Aim at the NPC and press E. Verify dialogue and **audible voice**. Branch, close, and reopen; verify the previous audio stops. Repeat with a `clip:<id>` recorded using `/npcstudio record <id>` and `/npcstudio stoprecord`.
7. Restart the server and verify placement persistence. Change the definition, sync, and verify the existing NPC stays unchanged until `/npcstudio apply`.
8. Only after all gates pass, coordinate the production merge and deployment.

If a step fails, retain the exact build or server console error and the tested Rust/Oxide version. Do not mark V1 released based solely on source code presence.
