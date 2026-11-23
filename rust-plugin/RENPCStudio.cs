using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using Oxide.Core.Libraries;
using Oxide.Core;
using Oxide.Core.Plugins;
using Oxide.Game.Rust.Cui;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("RENPCStudio", "Rust Empires", "0.4.0")]
    [Description("Standalone NPC Studio proof of concept: owner-only placement and custom E-interaction dialogue.")]
    public class RENPCStudio : RustPlugin
    {
        private const string UiName = "RENPCStudio.Dialogue";
        private const string PromptUiName = "RENPCStudio.TalkPrompt";
        private readonly HashSet<ulong> showingPrompt = new HashSet<ulong>();
        private const string DefaultPrefab = "assets/prefabs/player/player.prefab";

        private Configuration config;
        private StoredData data;
        private DefinitionFile definitions = new DefinitionFile();
        private readonly Dictionary<ulong, NpcDefinition> conversationDefinitions = new Dictionary<ulong, NpcDefinition>();
        private readonly Dictionary<ulong, string> conversationNode = new Dictionary<ulong, string>();
        private const string DefinitionFileName = "RENPCStudio_Definitions";
        private readonly Dictionary<ulong, BaseEntity> spawned = new Dictionary<ulong, BaseEntity>();
        private readonly HashSet<ulong> conversations = new HashSet<ulong>();
        private readonly Dictionary<ulong, Placement> pendingPlacements = new Dictionary<ulong, Placement>();
        private bool syncInProgress;

        private void DiscardPreview(ulong ownerId)
        {
            Placement pending;
            if (!pendingPlacements.TryGetValue(ownerId, out pending)) return;
            pendingPlacements.Remove(ownerId);
            BaseEntity entity;
            if (spawned.TryGetValue(pending.Id, out entity))
            {
                spawned.Remove(pending.Id);
                if (entity != null && !entity.IsDestroyed) entity.Kill();
            }
        }

        private class Configuration
        {
            public List<ulong> OwnerSteamIds = new List<ulong>();
            public string StudioUrl = "https://resil.me";
            public string RuntimeToken = "";
            public string NpcPrefab = DefaultPrefab;
            public string DisplayName = "Department Null Witness";
            public float InteractionDistance = 3f;
            public bool Invulnerable = true;
            public float Health = 100f;
            public List<Equipment> Clothing = new List<Equipment>();
        }

        // Carries a fully resolved placement/definition snapshot before BasePlayer.Spawn().
        // This mirrors HumanNPC's pre-spawn info assignment without importing its AI.
        private class StudioNpcMarker : MonoBehaviour
        {
            public BasePlayer Player;
            public ulong PlacementId;
            public string DefinitionId;
            public string NpcName;
            public float NpcHealth;
            public bool Invulnerable;
            private void Awake() { Player = GetComponent<BasePlayer>(); }

            public void Initialize(ulong placementId, string definitionId, string npcName, float health, bool invulnerable)
            {
                if (Player == null) throw new InvalidOperationException("StudioNpcMarker requires BasePlayer");
                PlacementId = placementId;
                DefinitionId = definitionId;
                NpcName = npcName;
                NpcHealth = health;
                Invulnerable = invulnerable;
                Player.displayName = npcName;
            }
        }

        private class Equipment
        {
            public string Shortname;
            public ulong SkinId;
        }

        private class Placement
        {
            public ulong Id;
            public int ShortId;
            public Vector3 Position;
            public float Yaw;
            public string DefinitionId;
            public int Revision;
            public NpcDefinition Snapshot;
        }

        private class StoredData
        {
            public List<Placement> Placements = new List<Placement>();
            public int NextShortId = 1;
        }

        private class DefinitionFile
        {
            public int SchemaVersion = 1;
            public List<NpcDefinition> Npcs = new List<NpcDefinition>();
        }

        private class NpcDefinition
        {
            public string Id;
            public string Name;
            public int Revision;
            public float Health = 100f;
            public bool Invulnerable = true;
            public List<Equipment> Clothing = new List<Equipment>();
            public string StartNode = "start";
            public List<DialogueNode> Dialogue = new List<DialogueNode>();
        }

        private class DialogueNode
        {
            public string Id;
            public string Text;
            public string Audio;
            public List<DialogueChoice> Choices = new List<DialogueChoice>();
        }

        private class DialogueChoice
        {
            public string Text;
            public string Next;
        }

        private NpcDefinition GetPlacementDefinition(Placement placement)
        {
            if (placement == null) return null;
            return placement.Snapshot ?? GetDefinition(placement.DefinitionId);
        }

        private NpcDefinition GetDefinition(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            return definitions.Npcs.Find(n => string.Equals(n.Id, id, StringComparison.OrdinalIgnoreCase));
        }

        private bool ReloadDefinitions(out string message)
        {
            try
            {
                var incoming = Interface.Oxide.DataFileSystem.ReadObject<DefinitionFile>(DefinitionFileName);
                if (incoming == null || incoming.SchemaVersion != 1 || incoming.Npcs == null)
                {
                    message = "Invalid definitions file or unsupported schema version.";
                    return false;
                }
                string validationMessage;
                if (!ValidateDefinitions(incoming, out validationMessage))
                {
                    message = validationMessage;
                    return false;
                }
                definitions = incoming;
                message = "Imported " + definitions.Npcs.Count + " NPC definitions.";
                return true;
            }
            catch (Exception ex)
            {
                message = "Could not read definitions: " + ex.Message;
                return false;
            }
        }

        private bool ValidateDefinitions(DefinitionFile incoming, out string message)
        {
            if (incoming == null || incoming.SchemaVersion != 1 || incoming.Npcs == null)
            {
                message = "Invalid definitions file or unsupported schema version.";
                return false;
            }
                var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var npc in incoming.Npcs)
                {
                    if (npc == null || string.IsNullOrWhiteSpace(npc.Id) || !ids.Add(npc.Id) ||
                        npc.Health < 1f || float.IsNaN(npc.Health) || float.IsInfinity(npc.Health) ||
                        string.IsNullOrWhiteSpace(npc.Name) || npc.Dialogue == null || npc.Clothing == null)
                    {
                        message = "Invalid NPC: missing/duplicate ID, name, clothing, or dialogue.";
                        return false;
                    }
                    var nodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var node in npc.Dialogue)
                        if (node == null || string.IsNullOrWhiteSpace(node.Id) ||
                            string.IsNullOrWhiteSpace(node.Text) || !nodes.Add(node.Id) ||
                            node.Choices == null || node.Choices.Count > 4 || (node.Audio != null && node.Audio.Length > 2048))
                        {
                            message = "Invalid dialogue node, missing text, or more than four choices in " + npc.Id;
                            return false;
                        }
                    if (npc.Dialogue.Count > 0 && !nodes.Contains(npc.StartNode ?? ""))
                    {
                        message = "Missing start dialogue node for " + npc.Id;
                        return false;
                    }
                    foreach (var node in npc.Dialogue)
                        foreach (var choice in node.Choices)
                            if (choice == null || string.IsNullOrWhiteSpace(choice.Text) ||
                                (!string.IsNullOrEmpty(choice.Next) && !nodes.Contains(choice.Next)))
                            {
                                message = "Broken dialogue choice in " + npc.Id + "/" + node.Id;
                                return false;
                            }
                }
            message = "Validated " + incoming.Npcs.Count + " definitions.";
            return true;
        }

        // Explicit remote sync: existing placements are NOT silently respawned.
        // Imported definitions are cached locally for server restart/offline use.
        private void SyncStudio(BasePlayer player)
        {
            if (syncInProgress)
            {
                if (player != null && player.IsConnected) player.ChatMessage("NPC Studio sync already in progress.");
                return;
            }
            if (string.IsNullOrWhiteSpace(config.StudioUrl) ||
                !Uri.IsWellFormedUriString(config.StudioUrl, UriKind.Absolute) ||
                !config.StudioUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                if (player != null && player.IsConnected) player.ChatMessage("StudioUrl must be an absolute HTTPS URL.");
                return;
            }
            if (string.IsNullOrWhiteSpace(config.RuntimeToken) || config.RuntimeToken.Length < 32)
            {
                if (player != null && player.IsConnected) player.ChatMessage("Set RuntimeToken (32+ characters) in the RENPCStudio server config.");
                return;
            }
            var headers = new Dictionary<string, string> { { "Authorization", "Bearer " + config.RuntimeToken } };
            syncInProgress = true;
            webrequest.Enqueue(config.StudioUrl.TrimEnd('/') + "/api/devtools/npcs/runtime", null, (code, body) =>
            {
                syncInProgress = false;
                if (code != 200 || string.IsNullOrEmpty(body))
                {
                    if (player != null && player.IsConnected) player.ChatMessage("NPC Studio sync failed (HTTP " + code + ").");
                    return;
                }
                try
                {
                    if (body.Length > 4000000) throw new Exception("NPC manifest exceeds size limit.");
                    var root = JObject.Parse(body);
                    if ((int?)root["version"] != 1) throw new Exception("Unsupported manifest version");
                    var incoming = new DefinitionFile();
                    var items = root["npcs"] as JArray;
                    if (items == null) throw new Exception("Missing NPC definitions");
                    if (items.Count > 1000) throw new Exception("NPC manifest exceeds 1000 definitions.");
                    if (items.Count == 0 && definitions.Npcs.Count > 0)
                        throw new Exception("Refusing to replace existing definitions with an empty manifest.");
                    foreach (var item in items)
                    {
                        if (item == null || item.Type != JTokenType.Object) throw new Exception("Malformed NPC manifest entry.");
                        var definition = item["definition"] as JObject;
                        if (definition == null) throw new Exception("Manifest contains an NPC without a definition.");
                        var npc = new NpcDefinition();
                        npc.Id = (string)item["id"];
                        npc.Name = (string)item["name"];
                        npc.Revision = (int?)item["revision"] ?? 0;
                        npc.Invulnerable = !((bool?)definition["killable"] ?? false);
                        npc.Health = (float?)definition["hp"] ?? 100f;
                        // The editor requires a start node; preserve it as the entry point.
                        npc.StartNode = "start";
                        var clothing = definition["equipment"] as JArray;
                        if (clothing != null) foreach (var piece in clothing)
                        {
                            if (piece == null || piece.Type != JTokenType.Object) throw new Exception("Malformed equipment entry.");
                            var shortname = (string)piece["shortname"];
                            ulong skin;
                            if (string.IsNullOrWhiteSpace(shortname) || !ulong.TryParse((string)piece["skinId"] ?? "0", out skin)) continue;
                            npc.Clothing.Add(new Equipment { Shortname = shortname, SkinId = skin });
                        }
                        var dialogue = definition["dialogue"] as JArray;
                        if (dialogue != null) foreach (var node in dialogue)
                        {
                            if (node == null || node.Type != JTokenType.Object) throw new Exception("Malformed dialogue node.");
                            var n = new DialogueNode { Id = (string)node["id"], Text = (string)node["text"], Audio = (string)node["audio"] };
                            var choices = node["choices"] as JArray;
                            if (choices != null) foreach (var choice in choices)
                            {
                                if (choice == null || choice.Type != JTokenType.Object) throw new Exception("Malformed dialogue choice.");
                                // Conditional choices cannot be evaluated by the V1 runtime.
                                // Fail closed instead of exposing a restricted response.
                                if (!string.IsNullOrWhiteSpace((string)choice["condition"]))
                                    throw new Exception("NPC " + npc.Id + " uses conditional dialogue choices not supported by Rust V1.");
                                n.Choices.Add(new DialogueChoice { Text = (string)choice["text"], Next = (string)choice["next"] });
                            }
                            npc.Dialogue.Add(n);
                        }
                        if (npc.Dialogue.Count > 0)
                            npc.StartNode = npc.Dialogue.Exists(n => n.Id == "start") ? "start" : npc.Dialogue[0].Id;
                        incoming.Npcs.Add(npc);
                    }
                    // Validate in memory before writing to disk, so failed syncs cannot corrupt the cache.
                    string message;
                    if (!ValidateDefinitions(incoming, out message)) throw new Exception(message);
                    Interface.Oxide.DataFileSystem.WriteObject(DefinitionFileName, incoming);
                    definitions = incoming;
                    if (player != null && player.IsConnected) player.ChatMessage("Synced " + definitions.Npcs.Count + " definitions. Existing NPCs unchanged; use /npcstudio apply to update placed instances.");
                }
                catch (Exception ex)
                {
                    PrintWarning("NPC Studio sync failed: " + ex.Message);
                    if (player != null && player.IsConnected) player.ChatMessage("NPC Studio sync rejected: " + ex.Message);
                }
            }, this, RequestMethod.GET, headers);
        }

        private void RefreshPlacedNpcs()
        {
            foreach (var placement in data.Placements)
            {
                if (string.IsNullOrEmpty(placement.DefinitionId)) continue;
                if (GetDefinition(placement.DefinitionId) == null) continue;
                BaseEntity old;
                // Remove the runtime mapping first: replacing an NPC must not delete its placement.
                spawned.TryGetValue(placement.Id, out old);
                spawned.Remove(placement.Id);
                if (old != null && !old.IsDestroyed) old.Kill();
                Spawn(placement);
            }
        }

        protected override void LoadDefaultConfig() => config = new Configuration();

        private void Init()
        {
            config = Config.ReadObject<Configuration>() ?? new Configuration();
            if (config.OwnerSteamIds == null) config.OwnerSteamIds = new List<ulong>();
            if (config.Clothing == null || config.Clothing.Count == 0)
            {
                config.Clothing = new List<Equipment>
                {
                    new Equipment { Shortname = "shirt.collared", SkinId = 0 },
                    new Equipment { Shortname = "pants", SkinId = 0 },
                    new Equipment { Shortname = "shoes.boots", SkinId = 0 }
                };
            }
            // Recover configurations bloated by repeated JSON list population.
            // Keep the first occurrence of each clothing slot/shortname + skin.
            var uniqueClothing = new List<Equipment>();
            var clothingKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in config.Clothing)
            {
                if (item == null || string.IsNullOrEmpty(item.Shortname)) continue;
                if (clothingKeys.Add(item.Shortname + ":" + item.SkinId)) uniqueClothing.Add(item);
            }
            config.Clothing = uniqueClothing;
            // Civilian test build: use the normal player prefab, without scientist AI.
            // Preserve definitions and persistent placements.
            config.NpcPrefab = DefaultPrefab;
            Config.WriteObject(config, true);
            data = Interface.Oxide.DataFileSystem.ReadObject<StoredData>(Name) ?? new StoredData();
            if (data.Placements == null) data.Placements = new List<Placement>();
            data.Placements.RemoveAll(p => p == null);
            if (data.NextShortId < 1) data.NextShortId = 1;
            // Migrate existing placements without changing their original persistent IDs.
            var used = new HashSet<int>();
            foreach (var placement in data.Placements)
            {
                if (placement.ShortId > 0 && !used.Contains(placement.ShortId))
                    used.Add(placement.ShortId);
                else
                    placement.ShortId = 0;
            }
            foreach (var placement in data.Placements)
            {
                if (placement.ShortId != 0) continue;
                while (used.Contains(data.NextShortId)) data.NextShortId++;
                placement.ShortId = data.NextShortId++;
                used.Add(placement.ShortId);
            }
            // Never reuse a previously assigned short ID after loading old saves.
            foreach (var usedId in used)
                if (data.NextShortId <= usedId) data.NextShortId = usedId + 1;
            // Older saved placements predate revision snapshots. Pin the currently
            // imported definition once at startup, without changing placed NPCs.
            if (used.Count > 0)
            {
                int max = 0;
                foreach (var value in used) if (value > max) max = value;
                if (data.NextShortId <= max) data.NextShortId = max + 1;
            }
            Save();
            string importMessage;
            if (!ReloadDefinitions(out importMessage)) PrintWarning(importMessage);
            else
            {
                Puts(importMessage);
                bool migrated = false;
                foreach (var placement in data.Placements)
                {
                    if (placement.Snapshot != null) continue;
                    var def = GetDefinition(placement.DefinitionId);
                    if (def == null) continue;
                    placement.Snapshot = def;
                    placement.Revision = def.Revision;
                    migrated = true;
                }
                if (migrated) Save();
            }
        }

        private void OnServerInitialized()
        {
            int restored = 0, failed = 0;
            foreach (var placement in data.Placements)
            {
                if (Spawn(placement)) restored++; else failed++;
            }
            Puts("NPC Studio startup: restored " + restored + ", failed " + failed + ".");
            timer.Every(0.2f, UpdateTalkPrompts);
        }

        private void Unload()
        {
            foreach (var player in BasePlayer.activePlayerList)
            {
                CuiHelper.DestroyUi(player, UiName);
                CuiHelper.DestroyUi(player, PromptUiName);
            }
            // Unload despawns runtime entities, but must retain saved placements.
            var runtimeEntities = new List<BaseEntity>(spawned.Values);
            spawned.Clear();
            foreach (var entity in runtimeEntities)
                if (entity != null && !entity.IsDestroyed) entity.Kill();
            conversations.Clear();
            conversationDefinitions.Clear();
            conversationNode.Clear();
            showingPrompt.Clear();
            pendingPlacements.Clear();
            syncInProgress = false;
        }

        private bool IsOwner(BasePlayer player) => player != null && config.OwnerSteamIds.Contains(player.userID);

        private void Save() => Interface.Oxide.DataFileSystem.WriteObject(Name, data);

        [ChatCommand("npcstudio")]
        private void CommandNpc(BasePlayer player, string command, string[] args)
        {
            if (!IsOwner(player))
            {
                player.ChatMessage("You are not authorized to manage NPC Studio.");
                return;
            }
            if (args == null || args.Length == 0)
            {
                player.ChatMessage("/npcstudio status | /npcstudio sync | /npcstudio apply | /npcstudio import | /npcstudio definitions | /npcstudio spawn <definition-id> | /npcstudio confirm | /npcstudio cancel | /npcstudio rotate <#> <degrees> | /npcstudio remove [#] | /npcstudio list");
                return;
            }
            switch (args[0].ToLowerInvariant())
            {
                case "status":
                {
                    int updates = 0;
                    int missing = 0;
                    foreach (var placement in data.Placements)
                    {
                        var current = GetDefinition(placement.DefinitionId);
                        if (current == null) { missing++; continue; }
                        if (placement.Snapshot == null || placement.Revision != current.Revision) updates++;
                    }
                    player.ChatMessage("NPC Studio: " + definitions.Npcs.Count + " definitions, " + data.Placements.Count +
                        " placements, " + updates + " pending updates, " + missing + " missing definitions. " +
                        (syncInProgress ? "Sync in progress." : "Sync idle.") +
                        " Voice playback: not implemented.");
                    break;
                }
                case "sync":
                    SyncStudio(player);
                    break;
                case "apply":
                {
                    int applied = 0;
                    int failed = 0;
                    foreach (var placement in data.Placements)
                    {
                        var def = GetDefinition(placement.DefinitionId);
                        if (def == null || (placement.Snapshot != null && placement.Revision == def.Revision)) continue;
                        var previousSnapshot = placement.Snapshot;
                        var previousRevision = placement.Revision;
                        placement.Snapshot = def;
                        BaseEntity oldEntity;
                        spawned.TryGetValue(placement.Id, out oldEntity);
                        spawned.Remove(placement.Id);
                        if (oldEntity != null && !oldEntity.IsDestroyed) oldEntity.Kill();
                        if (Spawn(placement))
                        {
                            placement.Revision = def.Revision;
                            applied++;
                        }
                        else
                        {
                            placement.Snapshot = previousSnapshot;
                            placement.Revision = previousRevision;
                            if (!Spawn(placement)) PrintWarning("Could not restore NPC #" + placement.ShortId + " after failed update.");
                            failed++;
                        }
                    }
                    Save();
                    player.ChatMessage("Updated " + applied + " NPCs; " + failed + " failed (previous definitions restored where possible).");
                    break;
                }
                case "import":
                {
                    string result;
                    ReloadDefinitions(out result);
                    player.ChatMessage(result);
                    break;
                }
                case "definitions":
                    player.ChatMessage(definitions.Npcs.Count == 0 ? "No imported definitions." :
                        "Definitions: " + string.Join(", ", definitions.Npcs.ConvertAll(n => n.Id).ToArray()));
                    break;
                case "spawn":
                {
                    // Stage a placement without spawning or saving it. Confirmation
                    // uses the exact location/facing captured when previewed.
                    string definitionId = args.Length > 1 ? args[1] : null;
                    var definition = GetDefinition(definitionId);
                    if (string.IsNullOrEmpty(definitionId) || definition == null)
                    {
                        player.ChatMessage("Usage: /npcstudio spawn <definition-id>. See /npcstudio definitions.");
                        return;
                    }
                    var preview = new Placement
                    {
                        Id = AllocatePlacementId(),
                        ShortId = data.NextShortId,
                        Position = GroundPosition(player.transform.position),
                        Yaw = player.eyes.rotation.eulerAngles.y,
                        DefinitionId = definitionId,
                        Revision = definition.Revision,
                        Snapshot = definition
                    };
                    DiscardPreview(player.userID);
                    if (!Spawn(preview))
                    {
                        player.ChatMessage("Could not create NPC preview; check server console.");
                        return;
                    }
                    pendingPlacements[player.userID] = preview;
                    player.ChatMessage("NPC preview #" + preview.ShortId + ": " + definition.Name +
                        " at " + preview.Position.ToString("F1") +
                        ", facing " + preview.Yaw.ToString("F1") +
                        " degrees. The temporary NPC is visible in-world. /npcstudio confirm to save, or /npcstudio cancel to remove it.");
                    break;
                }
                case "confirm":
                {
                    Placement preview;
                    if (!pendingPlacements.TryGetValue(player.userID, out preview))
                    {
                        player.ChatMessage("No pending placement. Use /npcstudio spawn <definition-id>.");
                        return;
                    }
                    preview.ShortId = data.NextShortId;
                    BaseEntity previewEntity;
                    if (!spawned.TryGetValue(preview.Id, out previewEntity) || previewEntity == null || previewEntity.IsDestroyed)
                    {
                        if (!Spawn(preview))
                        {
                            player.ChatMessage("NPC spawn failed. Preview retained; check server console.");
                            return;
                        }
                    }
                    data.NextShortId++;
                    data.Placements.Add(preview);
                    pendingPlacements.Remove(player.userID);
                    Save();
                    player.ChatMessage("Placed NPC #" + preview.ShortId + " with pinned revision " + preview.Revision + ".");
                    break;
                }
                case "cancel":
                    DiscardPreview(player.userID);
                    player.ChatMessage("Pending NPC placement canceled.");
                    break;
                case "rotate":
                {
                    float degrees;
                    if (args.Length < 3 || !float.TryParse(args[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out degrees))
                    {
                        player.ChatMessage("Usage: /npcstudio rotate <id> <degrees> (absolute compass yaw)");
                        return;
                    }
                    var placement = FindPlacement(args[1]);
                    if (placement == null) { player.ChatMessage("Unknown placement number."); return; }
                    placement.Yaw = Mathf.Repeat(degrees, 360f);
                    BaseEntity entity;
                    if (spawned.TryGetValue(placement.Id, out entity) && entity != null && !entity.IsDestroyed)
                        ApplyFacing(entity, placement.Yaw);
                    Save();
                    player.ChatMessage("NPC rotation set to " + placement.Yaw.ToString("F1") + " degrees.");
                    break;
                }
                case "list":
                    player.ChatMessage(data.Placements.Count == 0 ? "No placed NPCs." : string.Join(" | ", data.Placements.ConvertAll(p => "#" + p.ShortId).ToArray()));
                    break;
                case "kill":
                case "remove":
                {
                    Placement placement = args[0].Equals("kill", StringComparison.OrdinalIgnoreCase) ? FindLookedAtPlacement(player) : (args.Length >= 2 ? FindPlacement(args[1]) : FindLookedAtPlacement(player));
                    if (placement == null)
                    {
                        player.ChatMessage(args[0].Equals("kill", StringComparison.OrdinalIgnoreCase) ? "Look directly at a RE-NPCStudio NPC within interaction range (3m by default)." : (args.Length >= 2 ? "Unknown NPC number." : "Look directly at an NPC within interaction range, or use /npcstudio remove <#>."));
                        return;
                    }
                    RemovePlacementPermanently(placement);
                    player.ChatMessage("Permanently removed NPC #" + placement.ShortId + ".");
                    break;
                }
                case "debugspawn":
                    DebugSpawnPlayer(player);
                    break;
                case "test":
                    OpenDialogue(player);
                    break;
                default:
                    player.ChatMessage("Unknown command. Try /npcstudio");
                    break;
            }
        }

        // Shared deletion path for /npcstudio kill and /npcstudio remove.
        // Unregister before calling Kill() so the entity-death hook cannot race
        // with this command and leave stale records or perform a second removal.
        private void RemovePlacementPermanently(Placement placement)
        {
            BaseEntity entity;
            spawned.TryGetValue(placement.Id, out entity);
            spawned.Remove(placement.Id);
            data.Placements.RemoveAll(p => p.Id == placement.Id);
            Save();
            if (entity != null && !entity.IsDestroyed) entity.Kill();
        }

        // If a managed NPC dies by any other means, its persistent placement
        // must also be removed. Unload and definition refresh clear the runtime
        // mapping before killing, so neither operation deletes saved NPCs.
        private void OnEntityKill(BaseNetworkable networkable)
        {
            var entity = networkable as BaseEntity;
            if (entity == null || data == null) return;
            ulong placementId = 0;
            bool found = false;
            foreach (var entry in spawned)
            {
                if (entry.Value != entity) continue;
                placementId = entry.Key;
                found = true;
                break;
            }
            if (!found) return;
            spawned.Remove(placementId);
            // A destroyed temporary preview must never become a saved placement.
            var abandonedOwners = new List<ulong>();
            foreach (var preview in pendingPlacements)
                if (preview.Value.Id == placementId) abandonedOwners.Add(preview.Key);
            foreach (var owner in abandonedOwners) pendingPlacements.Remove(owner);
            if (data.Placements.RemoveAll(p => p.Id == placementId) > 0)
            {
                Save();
                Puts("Removed saved placement for destroyed NPC " + placementId + ".");
            }
        }

        private ulong AllocatePlacementId()
        {
            ulong id = (ulong)DateTime.UtcNow.Ticks;
            while (id == 0 || data.Placements.Exists(p => p.Id == id) || PendingIdExists(id)) id++;
            return id;
        }

        private bool PendingIdExists(ulong id)
        {
            foreach (var pending in pendingPlacements.Values)
                if (pending.Id == id) return true;
            return false;
        }

        private Placement FindPlacement(string token)
        {
            int number;
            if (string.IsNullOrWhiteSpace(token)) return null;
            if (int.TryParse(token.Trim().TrimStart('#'), out number))
                return data.Placements.Find(p => p.ShortId == number);
            ulong legacyId;
            if (ulong.TryParse(token, out legacyId))
                return data.Placements.Find(p => p.Id == legacyId);
            return null;
        }

        private Placement FindLookedAtPlacement(BasePlayer player)
        {
            RaycastHit hit;
            if (player == null || !player.IsConnected || config.InteractionDistance <= 0f || !Physics.Raycast(player.eyes.HeadRay(), out hit, config.InteractionDistance)) return null;
            var target = hit.GetEntity();
            if (target == null || target.net == null) return null;
            foreach (var placement in data.Placements)
            {
                BaseEntity entity;
                if (spawned.TryGetValue(placement.Id, out entity) && entity != null && !entity.IsDestroyed && entity.net != null && entity.net.ID == target.net.ID)
                    return placement;
            }
            return null;
        }

        // Isolated test: no saved placement, clothing, dialogue, or NPC component.
        // The entity is removed automatically, including if network spawning throws.
        private void DebugSpawnPlayer(BasePlayer caller)
        {
            BaseEntity candidate = null;
            string stage = "create";
            try
            {
                Vector3 position = GroundPosition(caller.transform.position + (caller.eyes.rotation * Vector3.forward) * 2f);
                candidate = GameManager.server.CreateEntity(DefaultPrefab, position,
                    Quaternion.Euler(0f, caller.eyes.rotation.eulerAngles.y, 0f));
                if (candidate == null) { caller.ChatMessage("Debug spawn: player prefab not found."); return; }
                var npc = candidate as BasePlayer;
                if (npc == null) { caller.ChatMessage("Debug spawn: prefab is not BasePlayer."); candidate.Kill(); return; }
                npc.displayName = "RE Spawn Probe";
                npc.syncPosition = true;
                stage = "Spawn";
                Puts("DEBUGSPAWN: stage=" + stage + " playerId=" + npc.userID + " netId=" +
                    (candidate.net != null ? candidate.net.ID.ToString() : "none") + " (identity unmodified, no marker, no inventory, no persistence)");
                candidate.Spawn();
                stage = "post-Spawn";
                candidate.enableSaving = false;
                caller.ChatMessage("Debug spawn succeeded. Probe will disappear in 5 seconds.");
                var cleanup = candidate;
                timer.Once(5f, () => { if (cleanup != null && !cleanup.IsDestroyed) cleanup.Kill(); });
            }
            catch (Exception ex)
            {
                PrintError("DEBUGSPAWN failed at " + stage + " identityUnmodified=true: " + ex);
                caller.ChatMessage("Debug spawn failed at " + stage + ". Send DEBUGSPAWN console lines.");
                if (candidate != null && !candidate.IsDestroyed)
                {
                    try { candidate.Kill(); }
                    catch (Exception cleanupEx) { PrintWarning("DEBUGSPAWN cleanup failed: " + cleanupEx.Message); }
                }
            }
        }

        // Batch civilian integration. The v0.3.12 isolated probe demonstrated that
        // leaving BasePlayer.userID/UserIDString untouched permits player.prefab
        // to spawn on this server. Never synthesize an identity here.
        private bool Spawn(Placement placement)
        {
            BaseEntity entity = null;
            string stage = "create";
            try
            {
                placement.Position = GroundPosition(placement.Position);
                entity = GameManager.server.CreateEntity(DefaultPrefab, placement.Position,
                    Quaternion.Euler(0f, placement.Yaw, 0f));
                if (entity == null)
                {
                    PrintWarning("Civilian spawn: player prefab not found for #" + placement.ShortId);
                    return false;
                }
                var npc = entity as BasePlayer;
                if (npc == null)
                {
                    PrintWarning("Civilian spawn: prefab did not create BasePlayer for #" + placement.ShortId);
                    entity.Kill();
                    return false;
                }
                var definition = GetPlacementDefinition(placement);
                npc.displayName = definition != null ? definition.Name : config.DisplayName;
                npc.syncPosition = true;
                stage = "network-spawn";
                Puts("CIVILIAN: #" + placement.ShortId + " stage=" + stage +
                    " prefab=" + DefaultPrefab + " identityUnmodified=true playerId=" + npc.userID);
                entity.Spawn();
                // At this point Rust has successfully registered the unmodified
                // player prefab. All NPCStudio-specific setup happens afterward.
                stage = "disable-saving";
                entity.enableSaving = false;
                stage = "marker";
                var marker = entity.gameObject.AddComponent<StudioNpcMarker>();
                marker.Initialize(placement.Id, placement.DefinitionId, npc.displayName,
                    definition != null ? Mathf.Max(1f, definition.Health) : config.Health,
                    definition != null ? definition.Invulnerable : config.Invulnerable);
                stage = "health";
                float health = definition != null ? Mathf.Max(1f, definition.Health) : config.Health;
                npc.InitializeHealth(health, health);
                stage = "inventory";
                StripCombatInventory(npc);
                stage = "clothing";
                Dress(npc, definition != null ? definition.Clothing : config.Clothing);
                stage = "rotation";
                ApplyFacing(entity, placement.Yaw);
                stage = "register";
                spawned[placement.Id] = entity;
                timer.Once(0.25f, () =>
                {
                    if (entity != null && !entity.IsDestroyed) ApplyFacing(entity, placement.Yaw);
                });
                Puts("CIVILIAN: #" + placement.ShortId + " stage=ready name=" + npc.displayName +
                    " playerId=" + npc.userID + " netId=" + (entity.net != null ? entity.net.ID.ToString() : "none") +
                    " clothing=" + (definition != null ? definition.Clothing.Count : config.Clothing.Count));
                return true;
            }
            catch (Exception ex)
            {
                PrintError("CIVILIAN: #" + placement.ShortId + " failed at stage=" + stage + ": " + ex);
                spawned.Remove(placement.Id);
                if (entity != null && !entity.IsDestroyed)
                {
                    try { entity.Kill(); }
                    catch (Exception cleanupEx) { PrintWarning("Civilian spawn cleanup failed: " + cleanupEx.Message); }
                }
                return false;
            }
        }

        private Vector3 GroundPosition(Vector3 position)
        {
            RaycastHit hit;
            // Start above the player's feet so foundations, floors and terrain can all be detected.
            if (Physics.Raycast(position + Vector3.up * 1.5f, Vector3.down, out hit, 5f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
                return hit.point + Vector3.up * 0.04f;
            return position;
        }

        private void ApplyFacing(BaseEntity entity, float yaw)
        {
            entity.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            var player = entity as BasePlayer;
            if (player != null)
            {
                player.viewAngles = new Vector3(0f, yaw, 0f);
                player.eyes.NetworkUpdate(Quaternion.Euler(0f, yaw, 0f));
            }
            entity.SendNetworkUpdateImmediate();
        }

        private bool IsLookingAtStudioNpc(BasePlayer player)
        {
            if (player == null || !player.IsConnected || player.IsDead() || player.IsSleeping() || conversations.Contains(player.userID) || config.InteractionDistance <= 0f) return false;
            RaycastHit hit;
            if (!Physics.Raycast(player.eyes.HeadRay(), out hit, config.InteractionDistance)) return false;
            var entity = hit.GetEntity();
            if (entity == null || entity.net == null) return false;
            // Temporary placement previews are not live NPCs: do not offer dialogue
            // until their owner explicitly confirms the placement.
            foreach (var placement in data.Placements)
            {
                BaseEntity npc;
                if (spawned.TryGetValue(placement.Id, out npc) &&
                    npc != null && !npc.IsDestroyed && npc.net != null &&
                    npc.net.ID == entity.net.ID) return true;
            }
            return false;
        }

        private void UpdateTalkPrompts()
        {
            foreach (var player in BasePlayer.activePlayerList)
            {
                if (player == null || !player.IsConnected) continue;
                bool visible = IsLookingAtStudioNpc(player);
                if (visible && showingPrompt.Add(player.userID))
                {
                    var ui = new CuiElementContainer();
                    // CUI cannot reliably project NPC world coordinates on the server.
                    // Offset the prompt above/right of the player's aim point, near the
                    // targeted NPC's head at normal talking distance.
                    ui.Add(new CuiPanel
                    {
                        Image = { Color = "0.10 0.12 0.12 0.84" },
                        RectTransform = { AnchorMin = "0.555 0.545", AnchorMax = "0.605 0.578" },
                        CursorEnabled = false
                    }, "Overlay", PromptUiName);
                    ui.Add(new CuiPanel
                    {
                        Image = { Color = "0.30 0.34 0.33 0.95" },
                        RectTransform = { AnchorMin = "0.080 0.15", AnchorMax = "0.438 0.85" }
                    }, PromptUiName, PromptUiName + ".Key");
                    ui.Add(new CuiLabel
                    {
                        Text = { Text = "E", FontSize = 11, Align = TextAnchor.MiddleCenter, Color = "1 1 1 1" },
                        RectTransform = { AnchorMin = "0 0", AnchorMax = "1 1" }
                    }, PromptUiName + ".Key");
                    ui.Add(new CuiLabel
                    {
                        Text = { Text = "TALK", FontSize = 10, Align = TextAnchor.MiddleCenter, Color = "0.92 0.93 0.89 1" },
                        RectTransform = { AnchorMin = "0.46 0", AnchorMax = "0.98 1" }
                    }, PromptUiName);
                    CuiHelper.AddUi(player, ui);
                }
                else if (!visible && showingPrompt.Remove(player.userID))
                    CuiHelper.DestroyUi(player, PromptUiName);
            }
        }

        // POC compatibility: disable AI brain components on our spawned scientist only.
        // Rust builds differ; log which components were actually disabled.
        private void DisableCombatAI(BasePlayer npc)
        {
            int disabled = 0;
            foreach (var behaviour in npc.GetComponents<MonoBehaviour>())
            {
                if (behaviour == null) continue;
                var typeName = behaviour.GetType().Name;
                if (typeName.IndexOf("Brain", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    behaviour.enabled = false;
                    disabled++;
                    Puts("Disabled NPC AI component: " + typeName);
                }
            }
            var agent = npc.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (agent != null)
            {
                agent.enabled = false;
                Puts("Disabled NPC NavMeshAgent.");
            }
            if (disabled == 0)
                PrintWarning("No NPC brain component found. NPC may still be hostile; inspect prefab components.");
        }

        // Remove inherited prefab weapons and ammunition. NPC Studio V1 is non-combat.
        private void StripCombatInventory(BasePlayer npc)
        {
            if (npc.inventory == null) return;
            if (npc.inventory.containerBelt != null) npc.inventory.containerBelt.Clear();
            if (npc.inventory.containerMain != null) npc.inventory.containerMain.Clear();
            npc.SendNetworkUpdateImmediate();
        }

        private void Dress(BasePlayer npc, List<Equipment> clothing)
        {
            if (npc.inventory == null || npc.inventory.containerWear == null) return;
            npc.inventory.containerWear.Clear();
            if (clothing == null) return;
            foreach (var piece in clothing)
            {
                if (piece == null || string.IsNullOrEmpty(piece.Shortname)) continue;
                var item = ItemManager.CreateByName(piece.Shortname, 1, piece.SkinId);
                if (item == null)
                {
                    PrintWarning("Unknown item: " + piece.Shortname);
                    continue;
                }
                if (!item.MoveToContainer(npc.inventory.containerWear))
                {
                    PrintWarning("Cannot equip: " + piece.Shortname);
                    item.Remove();
                }
            }
            npc.SendNetworkUpdateImmediate();
        }

        private void OnPlayerInput(BasePlayer player, InputState input)
        {
            if (player == null || !player.IsConnected || player.IsDead() || player.IsSleeping() || input == null || !input.WasJustPressed(BUTTON.USE)) return;
            if (conversations.Contains(player.userID)) return;
            if (IsLookingAtStudioNpc(player))
            {
                var placement = FindLookedAtPlacement(player);
                OpenDialogue(player, null, GetPlacementDefinition(placement));
            }
        }

        private object OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null) return null;
            // Previews are never damageable: a bystander must not be able to
            // destroy an unconfirmed placement before its owner accepts it.
            foreach (var preview in pendingPlacements.Values)
            {
                BaseEntity temporary;
                if (spawned.TryGetValue(preview.Id, out temporary) && temporary == entity)
                    return true;
            }
            foreach (var placement in data.Placements)
            {
                BaseEntity npc;
                if (spawned.TryGetValue(placement.Id, out npc) && npc == entity)
                {
                    var definition = GetPlacementDefinition(placement);
                    return (definition != null ? definition.Invulnerable : config.Invulnerable) ? (object)true : null;
                }
            }
            return null;
        }

        private void OpenDialogue(BasePlayer player, string response = null, NpcDefinition definition = null)
        {
            if (player == null || !player.IsConnected || player.IsDead() || player.IsSleeping()) return;
            CuiHelper.DestroyUi(player, UiName);
            CuiHelper.DestroyUi(player, PromptUiName);
            showingPrompt.Remove(player.userID);
            // Test dialogue must not accidentally reuse the previous NPC session.
            if (definition == null && !conversations.Contains(player.userID))
            {
                conversationDefinitions.Remove(player.userID);
                conversationNode.Remove(player.userID);
            }
            conversations.Add(player.userID);
            if (definition != null)
            {
                conversationDefinitions[player.userID] = definition;
                conversationNode[player.userID] = definition.StartNode;
            }
            NpcDefinition activeDefinition;
            conversationDefinitions.TryGetValue(player.userID, out activeDefinition);
            string currentNode;
            conversationNode.TryGetValue(player.userID, out currentNode);
            var activeNode = activeDefinition != null && activeDefinition.Dialogue != null
                ? activeDefinition.Dialogue.Find(n => n.Id == currentNode) : null;
            if (activeDefinition != null && activeNode == null) { CloseDialogue(player); return; }
            var ui = new CuiElementContainer();
            var panel = ui.Add(new CuiPanel
            {
                Image = { Color = "0.09 0.11 0.14 0.95" },
                RectTransform = { AnchorMin = "0.28 0.20", AnchorMax = "0.72 0.62" },
                CursorEnabled = true
            }, "Overlay", UiName);
            AddLabel(ui, panel, activeDefinition != null ? activeDefinition.Name : "DEPARTMENT NULL — INTERVIEW", "0.05 0.82", "0.95 0.98", 18);
            AddLabel(ui, panel, activeNode != null ? activeNode.Text : (response ?? "Internal Affairs? I already gave my statement."), "0.05 0.53", "0.95 0.80", 16);
            if (activeNode != null && activeNode.Choices != null)
            {
                for (int i = 0; i < activeNode.Choices.Count && i < 4; i++)
                {
                    var choice = activeNode.Choices[i];
                    float top = 0.51f - i * 0.13f;
                    AddButton(ui, panel, choice.Text, "re.npcstudio.choice " + i,
                        "0.05 " + (top - 0.11f).ToString(System.Globalization.CultureInfo.InvariantCulture),
                        "0.95 " + top.ToString(System.Globalization.CultureInfo.InvariantCulture));
                }
            }
            else if (activeDefinition == null)
            {
                AddButton(ui, panel, "Where were you?", "re.npcstudio.choice 0", "0.05 0.33", "0.95 0.49");
                AddButton(ui, panel, "Did you see anyone?", "re.npcstudio.choice 1", "0.05 0.15", "0.95 0.31");
            }
            AddButton(ui, panel, "Close", "re.npcstudio.close", "0.73 0.02", "0.95 0.13");
            CuiHelper.AddUi(player, ui);
        }

        private void AddLabel(CuiElementContainer ui, string parent, string value, string min, string max, int size)
        {
            ui.Add(new CuiLabel
            {
                Text = { Text = value, FontSize = size, Align = TextAnchor.MiddleLeft, Color = "1 1 1 1" },
                RectTransform = { AnchorMin = min, AnchorMax = max }
            }, parent);
        }

        private void AddButton(CuiElementContainer ui, string parent, string label, string command, string min, string max)
        {
            ui.Add(new CuiButton
            {
                Button = { Command = command, Color = "0.20 0.28 0.34 1" },
                RectTransform = { AnchorMin = min, AnchorMax = max },
                Text = { Text = label, FontSize = 14, Align = TextAnchor.MiddleCenter }
            }, parent);
        }

        [ConsoleCommand("re.npcstudio.choice")]
        private void Choice(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if (player == null || !player.IsConnected || !conversations.Contains(player.userID)) return;
            var choice = arg.GetString(0, "");
            NpcDefinition d;
            if (conversationDefinitions.TryGetValue(player.userID, out d))
            {
                string nodeId;
                if (d == null || !conversationNode.TryGetValue(player.userID, out nodeId)) return;
                var node = d.Dialogue.Find(n => n.Id == nodeId);
                int index;
                if (node == null || !int.TryParse(choice, out index) || index < 0 || index >= node.Choices.Count || index >= 4) return;
                var next = node.Choices[index].Next;
                if (string.IsNullOrEmpty(next)) { CloseDialogue(player); return; }
                conversationNode[player.userID] = next;
                OpenDialogue(player);
                return;
            }
            if (d == null && choice == "0") OpenDialogue(player, "I was in the breakroom. The furnace wasn't running.");
            else if (d == null && choice == "1") OpenDialogue(player, "No. I didn't see anyone.");
        }

        [ConsoleCommand("re.npcstudio.close")]
        private void Close(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if (player == null) return;
            CloseDialogue(player);
        }

        private void CloseDialogue(BasePlayer player)
        {
            conversations.Remove(player.userID);
            conversationDefinitions.Remove(player.userID);
            conversationNode.Remove(player.userID);
            CuiHelper.DestroyUi(player, UiName);
            CuiHelper.DestroyUi(player, PromptUiName);
            showingPrompt.Remove(player.userID);
        }

        private void OnPlayerDisconnected(BasePlayer player, string reason)
        {
            if (player != null)
            {
                conversations.Remove(player.userID);
                conversationDefinitions.Remove(player.userID);
                conversationNode.Remove(player.userID);
                showingPrompt.Remove(player.userID);
                DiscardPreview(player.userID);
                CuiHelper.DestroyUi(player, UiName);
                CuiHelper.DestroyUi(player, PromptUiName);
            }
        }
    }
}