# NPC Studio V1 release candidate

The release candidate uses RENPCStudio v0.4.8. Keep the website and plugin on the same candidate during testing.

The website build and 136 automated tests pass. An isolated database smoke test covered administrator access, WAV upload and conversion, browser preview, publication, runtime bearer authentication, packet retrieval, and revision conflicts. A previous Rust client test confirmed that the generated diagnostic clip was audible. The uploaded-audio path still needs a live Rust client pass.

## Staging setup

1. Deploy this candidate on the NPC Studio test website with `RESIL_NPC_RUNTIME_TOKEN` set to a private value of at least 32 characters.
2. Install `RENPCStudio.cs` into `oxide/plugins/` on the test Rust server. Set `StudioUrl`, the matching `RuntimeToken` and `OwnerSteamIds` in `oxide/config/RENPCStudio.json`. Run `oxide.reload RENPCStudio` and check that v0.4.8 loads.
3. In `/devtools/npcstudio`, create an NPC with clothing, a short uploaded spoken line on the start node, and at least two responses. Preview the recording in the browser, then save.
4. Run `/npcstudio sync` and `/npcstudio definitions`. Stand where the NPC should appear and face its intended direction. Run `/npcstudio spawn <definition-id>`, inspect the preview, then run `/npcstudio confirm`.
5. As a player, aim at the NPC and press E. Check that the opening line is audible, that branching or closing interrupts it, and that a separate client can hear the same line in its own conversation.
6. Edit the start text on the website, save, and sync. Confirm that the placed NPC still uses the prior revision. Run `/npcstudio apply`, confirm the new revision, then reload the plugin and check placement persistence. Check the default invulnerability and optional killability with a disposable NPC.

If the plugin fails to load, capture the first Oxide compiler error. If dialogue opens silently, capture the Rust server's NPC voice warnings and whether the browser preview was audible. The `/npcstudio play generatedtest` diagnostic can confirm the standalone path where the previously loaded clip is available.
