// ResilNpcRuntime.cs — first-party Oxide/uMod Rust plugin prototype.
// Requires a staging Rust server for compilation and behavioral verification.
// Audio playback is deliberately NOT claimed or implemented.
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Oxide.Core;
using Oxide.Core.Libraries;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("Resil NPC Runtime", "resil.me", "0.1.0")]
    [Description("Stationary NPC placement and dialogue backed by resil.me NPC Studio.")]
    public class ResilNpcRuntime : RustPlugin
    {
        private class Settings
        {
            [JsonProperty("NPC Studio URL")] public string Url = "https://resil.me";
            [JsonProperty("Runtime token (set on server only)")] public string Token = "";
            [JsonProperty("Poll definitions on command only")] public bool ManualRefresh = true;
        }
        private class Placement
        {
            public string Id;
            public string NpcId;
            public int Revision;
            public Vector3 Position;
            public float Yaw;
        }
        private class Storage
        {
            public List<Placement> Placements = new List<Placement>();
        }
        private class Definition
        {
            public string Id;
            public string Name;
            public int Revision;
            public JObject Body;
        }
        private Settings settings;
        private Storage storage;
        private readonly Dictionary<string, Definition> definitions = new Dictionary<string, Definition>();
        private readonly Dictionary<string, BaseEntity> entities = new Dictionary<string, BaseEntity>();
        private readonly Dictionary<ulong, string> conversations = new Dictionary<ulong, string>();
        private readonly Dictionary<ulong, string> currentNodes = new Dictionary<ulong, string>();
        private const string Permission = "resilnpc.admin";
        private const string NpcPrefab = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc.prefab";

        protected override void LoadDefaultConfig() { settings = new Settings(); SaveConfig(); }
        protected override void LoadConfig()
        {
            base.LoadConfig();
            try { settings = Config.ReadObject<Settings>() ?? new Settings(); }
            catch { settings = new Settings(); }
        }
        protected override void SaveConfig() => Config.WriteObject(settings, true);
        private void Init()
        {
            permission.RegisterPermission(Permission, this);
            storage = Interface.Oxide.DataFileSystem.ReadObject<Storage>(Name) ?? new Storage();
        }
        private void OnServerInitialized()
        {
            foreach (var placement in storage.Placements.ToList()) Spawn(placement);
            Puts("NPC runtime loaded. Use /resilnpc sync to fetch definitions.");
        }
        private void Unload()
        {
            foreach (var entity in entities.Values) if (entity != null && !entity.IsDestroyed) entity.Kill();
            entities.Clear();
            SaveData();
        }
        private void SaveData() => Interface.Oxide.DataFileSystem.WriteObject(Name, storage);
        private bool Authorized(BasePlayer player) => player.IsAdmin || permission.UserHasPermission(player.UserIDString, Permission);
        private void Sync(BasePlayer player)
        {
            if (string.IsNullOrWhiteSpace(settings.Token) || settings.Token.Length < 32)
            {
                Reply(player, "Set the runtime token in the plugin configuration before syncing.");
                return;
            }
            var headers = new Dictionary<string, string> { ["Authorization"] = "Bearer " + settings.Token };
            webrequest.Enqueue(settings.Url.TrimEnd('/') + "/api/devtools/npcs/runtime", null, (code, body) =>
            {
                if (code != 200 || string.IsNullOrWhiteSpace(body))
                {
                    Reply(player, "Definition sync failed (HTTP " + code + ").");
                    return;
                }
                try
                {
                    var root = JObject.Parse(body);
                    if ((int?)root["version"] != 1) throw new Exception("Unsupported manifest version");
                    var incoming = new Dictionary<string, Definition>();
                    foreach (var item in (JArray)root["npcs"])
                    {
                        var definition = new Definition {
                            Id = (string)item["id"],
                            Name = (string)item["name"],
                            Revision = (int)item["revision"],
                            Body = item["definition"] as JObject
                        };
                        if (string.IsNullOrEmpty(definition.Id) || definition.Body == null) continue;
                        incoming[definition.Id] = definition;
                    }
                    definitions.Clear();
                    foreach (var item in incoming) definitions[item.Key] = item.Value;
                    Reply(player, "Loaded " + definitions.Count + " NPC definitions. Existing placements remain pinned to their original revision.");
                }
                catch (Exception ex) { PrintWarning("Invalid NPC manifest: " + ex.Message); Reply(player, "NPC manifest could not be parsed."); }
            }, this, RequestMethod.GET, headers);
        }
        private void Reply(BasePlayer player, string message)
        {
            if (player != null && player.IsConnected) SendReply(player, message);
            else Puts(message);
        }
        [ChatCommand("resilnpc")]
        private void Command(BasePlayer player, string command, string[] args)
        {
            if (!Authorized(player)) { Reply(player, "You are not authorized."); return; }
            if (args.Length == 0) { Reply(player, "Usage: /resilnpc sync | list | place <id> | remove <instance-id>"); return; }
            switch (args[0].ToLowerInvariant())
            {
                case "sync": Sync(player); return;
                case "list":
                    Reply(player, definitions.Count == 0 ? "No definitions loaded. Run /resilnpc sync." :
                        string.Join(", ", definitions.Values.Select(x => x.Id + " (v" + x.Revision + ")").ToArray()));
                    return;
                case "place":
                    if (args.Length < 2 || !definitions.ContainsKey(args[1])) { Reply(player, "Unknown NPC ID. Run /resilnpc list."); return; }
                    var def = definitions[args[1]];
                    var placement = new Placement { Id = Guid.NewGuid().ToString("N"), NpcId = def.Id, Revision = def.Revision,
                        Position = player.transform.position + player.eyes.BodyForward() * 2f, Yaw = player.eyes.rotation.eulerAngles.y };
                    storage.Placements.Add(placement);
                    SaveData();
                    Spawn(placement);
                    Reply(player, "Placed " + def.Name + " as " + placement.Id + ". Position and facing follow your view.");
                    return;
                case "remove":
                    if (args.Length < 2) { Reply(player, "Provide the instance ID."); return; }
                    var found = storage.Placements.FirstOrDefault(x => x.Id == args[1]);
                    if (found == null) { Reply(player, "Instance not found."); return; }
                    if (entities.ContainsKey(found.Id) && entities[found.Id] != null) entities[found.Id].Kill();
                    entities.Remove(found.Id);
                    storage.Placements.Remove(found);
                    SaveData();
                    Reply(player, "NPC instance removed.");
                    return;
                default: Reply(player, "Unknown subcommand."); return;
            }
        }
        private void Spawn(Placement placement)
        {
            var entity = GameManager.server.CreateEntity(NpcPrefab, placement.Position, Quaternion.Euler(0, placement.Yaw, 0));
            if (entity == null) { PrintWarning("Could not create NPC prefab for " + placement.Id); return; }
            entity.enableSaving = false;
            entity.Spawn();
            entities[placement.Id] = entity;
        }
        // This prototype intentionally does not hook OnNpcConversationStart or promise E-to-talk:
        // the interaction mechanism must be verified against the actual Rust server API.
        // Likewise, audio bytes downloaded over HTTP do not automatically become playable in Rust.
    }
}
