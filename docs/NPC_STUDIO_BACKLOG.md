# NPC Studio backlog

## Dialogue-triggered privileged server actions

**Status:** Backlog — not implemented. **Priority:** Future enhancement.

Allow an NPC dialogue response or node to trigger a server-side administrative action on behalf of the interacting player, without granting that player permission to run the command directly.

**Example:** After the player chooses a qualifying dialogue option, the server may run an explicitly configured permission-grant command such as `oxide.grant user <playerId> <permission>` (exact syntax must be validated against the installed permissions system). The player must never be able to supply arbitrary command text or choose the target identity.

### Requirements / safety
- Actions are configured only by authorized NPC Studio administrators, and executed only by the trusted Rust server plugin, never by the browser or the player's client.
- Use a strict allowlist of supported commands/actions, with validated arguments and explicit per-action permissions; **no arbitrary console-command execution** from dialogue content.
- Resolve player placeholders exclusively from the authenticated in-game interacting player (e.g., SteamID), not from untrusted dialogue text.
- Support optional prerequisites/conditions, once-per-player or repeatable execution, and clear success/failure dialogue behavior.
- Log actor, NPC, action, target, time, and outcome for auditing; avoid exposing secrets or full sensitive command output to players.
- Make high-impact actions require confirmation and/or a separate restricted configuration workflow.
- Test for command injection, replay, impersonation, and accidental privilege escalation before enabling in production.

### Open design decisions
- Exact allowlisted commands and actions, and whether a command can target only the interacting player.
- Whether the action runs when a response is selected or after a dialogue node is completed.
- How administrators configure prerequisites, cooldowns, and success/failure branches.
