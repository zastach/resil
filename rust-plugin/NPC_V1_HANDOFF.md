# NPC Studio V1 — integration handoff (unverified build)

## Current implementation

- Website: admin-only NPC definition CRUD, folders, dialogue graph, equipment metadata, audio upload and preview, bearer-authenticated runtime manifest.
- Rust plugin: sync cached definitions; manually apply updates to placed NPCs; spawn/preview/confirm/rotate/remove; E-to-talk dialogue; optional killable HP; native voice recording/replay from NPC's network entity ID.
- All work remains on `npc-studio-full-v1`; nothing here deploys production.

## Native voice smoke test

1. Upload `rust-plugin/RENPCStudio.cs` to Shockbyte `oxide/plugins/` using its file manager/FTP. Run `oxide.reload RENPCStudio` in the console. **Stop and report any compile errors.**
2. Ensure your Steam ID is in the plugin's `OwnerSteamIds` config and reload.
3. In-game run `/npcstudio record witness_intro`, speak into Rust push-to-talk for a few seconds, then `/npcstudio stoprecord`. Check `/npcstudio clips`.
4. In the resil.me NPC editor, assign `clip:witness_intro` to the start dialogue node's `audio` field (the raw native-clip reference, not an uploaded MP3 URL).
5. Sync the definition with `/npcstudio sync`. Spawn and confirm a new NPC, or use `/npcstudio apply` to update an existing placement.
6. Press E while aiming at the NPC. Confirm audio plays from the NPC and stops when closing the conversation or choosing another response.

**Known limitations:** The editor's MP3/WAV/OGG uploads are stored but not converted to native Rust voice packets. Native clips are recorded in-game, stored on the Rust server, and are not synced from the website. The recording hook and network packet write path have not been compiled against the live Shockbyte build. If the Rust version's voice callback uses an ArraySegment rather than byte[], the recording hook will need the matching signature. No complete V1 claim is made.

## Release gate

- Plugin compiles on current Rust/Oxide.
- E-to-talk, dialogue transitions, and persistence work in-game.
- Native voice capture and playback work in-game.
- Website-uploaded audio converts to a versioned, bounded native packet stream and syncs securely to the server.
- Website editor is verified end-to-end.
- Full manual update lifecycle is verified; no automatic in-game notifications or updates.
