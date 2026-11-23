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

## Complete Rust wearable catalog, including unobtainable items

**Status:** Backlog — catalog verification required before production release.

Replace the current hardcoded, incomplete item arrays with a versioned catalog derived from Rust's actual item definitions and wearable-slot/conflict metadata. Include player-obtainable, admin-only, NPC-only, event, and unobtainable wearable items. User-requested examples include glowing eyes, bunny suit, BDU shirt/pants, burlap, hide, and metal body armor.

- Confirm actual shortnames and whether special items are separate item definitions, skins, or visual effects; do not invent IDs or treat skins as items.
- Capture correct wearable slots, multiple-slot occupancy, clothing incompatibilities, full-body blocking, and item icons.
- Show only compatible items for each body slot, with searchable names, visual previews, and an optional 'Special / Unobtainable' filter.
- Validate against the same canonical catalog in UI, JSON import/export, and server-side publishing; verify behavior in a Rust test server.
- Explicitly distinguish verified equipable items from unknown/unsupported items and provide useful validation errors.
- The current six-category editor and hand-maintained list are provisional and must not be represented as complete.

### Located source for comprehensive catalog (2026-11-22)

Rust dedicated-server clothing/armor item dump, 178 category entries (build 26431843, 2026-11-06): https://docs.cruciblegrounds.com/rust/items-clothing/

Secondary cross-check: https://wiki.facepunch.com/rust/ and https://rust.wiki/items?category=attire

**Verified shortname corrections:** glowing eyes = `gloweyes`; bunny costume = `bunny.suit`; bunny onesie = `attire.bunny.onesie`; BDU shirt = `bdu.shirt`; BDU pants = `bdu.pants`; metal chest plate = `metal.plate.torso`; burlap gloves = `burlap.gloves.new`; leather gloves = `burlap.gloves`; frog boots = `boots.frog`; small backpack = `smallbackpack`; large backpack = `largebackpack`.

**Important:** The 178 attire-category entries are NOT all human wearable items (horse equipment, shields, mannequin, etc. appear). Do not blindly expose all 178 in NPC wearable dropdowns. Server-side `ItemModWearable` inspection and conflict validation remain required. External source data has not yet been imported into the editor.
