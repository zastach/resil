# resil.me NPC Studio — Rust runtime V1

## Status (November 2026)
The canonical Oxide/uMod plugin source is `rust-plugin/RENPCStudio.cs` (v0.4.0, development branch `npc-studio-full-v1`). The duplicate experimental `ResilNpcRuntime.cs` has been removed to prevent accidental installation. The web application is deployed; the Rust plugin has **not been compiled against the target Rust/Oxide build or installed on Shockbyte**. Do not assume production readiness.

Implemented in source: owner-only commands, persistent civilian placements, configurable clothing and health, E-to-talk dialogue, definition sync, cached revision snapshots, explicit apply, and staged textual placement confirmation. **Not implemented:** verified in-world voice playback, a visual ghost preview, or server-side evaluation of conditional dialogue choices. Combat AI, movement, and 3D web previews are outside V1.

## Configuration and secrets
1. In Railway for the `zipline` service, configure `RESIL_NPC_RUNTIME_TOKEN` to a randomly generated secret of at least 32 characters. Keep it private.
2. On the staging Rust server, place `RENPCStudio.cs` in `oxide/plugins/`. After Oxide creates `oxide/config/RENPCStudio.json`, set `StudioUrl` to `https://resil.me`, `RuntimeToken` to **the same secret**, and `OwnerSteamIds` to the authorized Steam64 administrator IDs. Never commit tokens to GitHub or paste them in public logs.
3. Reload with `oxide.reload RENPCStudio`. Inspect Oxide compiler errors and the Rust console. The plugin has not been verified to compile on the current server build.
4. From an authorized administrator account, use `/npcstudio sync` to import published NPC definitions. This does not change already placed NPCs.
5. Run `/npcstudio definitions`, then `/npcstudio spawn <definition-id>` while standing at the location and facing the intended direction. Review the **text-only** location/yaw preview; use `/npcstudio confirm` or `/npcstudio cancel`.
6. When a web definition changes, `/npcstudio sync` imports it; `/npcstudio apply` explicitly replaces affected placed instances. Existing placements retain pinned snapshots until apply. Keep a backup of `oxide/data/RENPCStudio.json` and `oxide/data/RENPCStudio_Definitions.json` before updating.

## API contract
`GET /api/devtools/npcs/runtime` with `Authorization: Bearer <token>` returns a versioned NPC manifest. `GET /api/devtools/npcs/runtime/audio/:id` serves audio bytes to authorized runtime callers. Web-editor audio preview and storage **do not imply in-game audio playback**. The runtime currently imports node audio references but does not play them in Rust.

## Known limitations and release gates
- **Compile gate:** Compile the exact canonical plugin against the target Oxide/uMod Rust build; resolve API signatures and warnings.
- **Placement gate:** Verify civilian spawn, network registration, owner-only access, orientation, restart persistence, removal, and killable/invulnerable settings.
- **Dialogue gate:** Verify E-to-talk, all choice branches, disconnect/close cleanup, and that old placements do not change after sync without apply.
- **Audio gate:** Determine a supported, tested Rust client playback path for custom recorded voices, including supported format, distribution, proximity, interruption, and cleanup. No such mechanism is yet implemented.
- **Failure gate:** Test unreachable backend, invalid/expired token, malformed manifest, failed replacement spawn, and rollback. Do not run on the production Rust server before staging tests.
- **Editor/runtime mismatch:** Conditional choices are explicitly rejected at sync, not silently exposed. Only four choices are rendered per node by the current in-game UI. The first dialogue node is treated as the entry point.

## Scope
All NPC Studio functionality is first-party. No Codefling plugin or externally supplied NPC runtime is used. Web tools are site-admin-only; notifications about available definition updates belong in the authenticated web UI, not in Rust.
