# resil.me NPC Studio — Rust runtime integration (V1)

## Status
The web application exposes a token-protected manifest and voice-asset endpoint. **The Rust-side NPC plugin, in-world playback and placement are not yet implemented or tested.** Do not install this as if it were a working Rust plugin.

## Server configuration
Set `RESIL_NPC_RUNTIME_TOKEN` in the Railway `zipline` service to a randomly generated secret of at least 32 characters. Do not put the token in Git, browser code, or NPC definitions. Restart/redeploy the service after changing it.

## Runtime protocol
Every request must include `Authorization: Bearer <token>`.

- `GET https://resil.me/api/devtools/npcs/runtime` returns `{"version":1,"npcs":[{"id":"...","name":"...","definition":{...},"revision":1}]}`. This is the shared NPC library, not a list of placed NPCs.
- `GET https://resil.me/api/devtools/npcs/runtime/audio/voice-<uuid>` returns audio bytes and their content type, if present.
- Web-editor audio references are `/api/devtools/npcs/audio/voice-<uuid>`; the Rust runtime must rewrite this exact prefix to `/api/devtools/npcs/runtime/audio/voice-<uuid>` and authenticate.
- Never accept arbitrary URLs from dialogue definitions as trusted runtime download targets. For V1, use only same-origin uploaded audio references; remote URLs can still be previewed in the browser.

## V1 contract
The runtime must store placed instances separately from definitions: `instanceId`, `npcId`, `revision`, `position`, `rotation`, `serverId`. Updating a definition must not silently update an existing placement. An admin explicitly applies an update.

Interaction is **E-to-talk** (not proximity auto-talk). Default invulnerable; killable and HP only when enabled. Dialogue starts at `start`; responses link to another node, or terminate if no target. A condition string is currently reserved and must not be treated as executable code. Movement, combat, and weapons are out of scope. 3D web rendering is out of scope.

## Runtime audio
An HTTP download is **not** equivalent to playing audio inside Rust. The plugin must implement and test a Rust-supported playback mechanism with the actual server build before claiming that in-game voice works. The web-side audio upload accepts MP3, WAV, OGG up to 8 MiB; there is currently no server-side transcoding.

## Security and operations
- Token must be provisioned separately on Railway and the Rust server.
- Use HTTPS, enforce download size/time limits, and keep the token out of logs.
- A private server can fetch the runtime manifest; ordinary web visitors cannot.
- The web editor requires administrator authentication. Runtime endpoints use the separate server token.
- Test on a staging Rust server before production, including reload, despawn, restart persistence, permissions, and voice playback.
