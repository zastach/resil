using System;
using System.Collections.Generic;
using System.Linq;
using Oxide.Core;
using Oxide.Game.Rust.Cui;
using Newtonsoft.Json;
using System.Text.RegularExpressions;
using Oxide.Core.Plugins;
using UnityEngine;

namespace Oxide.Plugins
{
    [Info("RERaid", "zastach", "0.4.9")]
    [Description("Rust Empires raid encounters, sieges, events and builder review.")]
    public class RERaid : RustPlugin
    {
        private const int DefaultRecoverySeconds = 60;
        private const string RecoverySecondsKey = "StandardRecoverySeconds";
        private const string GrayDomePrefab = "assets/prefabs/visualization/sphere.prefab";
        private const string GreenDomePrefab = "assets/bundled/prefabs/modding/events/twitch/br_sphere_green.prefab";
        private const string PurpleDomePrefab = "assets/bundled/prefabs/modding/events/twitch/br_sphere_purple.prefab";
        private const float EjectionClearance = 3f;
        private static readonly float[] EjectionAngles = { 0f, 15f, -15f, 30f, -30f, 60f, -60f, 90f, -90f, 180f };
        private const string RaidPinPrefab = "assets/prefabs/deployable/vendingmachine/vending_mapmarker.prefab";
        private const string AdminPermission = "reraid.admin";
        private static readonly Regex PasteName = new Regex(@"\A[A-Za-z0-9_-][A-Za-z0-9_. -]{0,79}\z");

        [PluginReference]
        private Plugin CopyPaste, Clans, ServerRewards;

        private readonly List<Preview> encounters = new List<Preview>();
        private int nextId;
        private Preview At(Vector3 pos) => encounters.FirstOrDefault(r => Inside(r, pos));
        private Preview ForPlayer(BasePlayer player)
        {
            var pos = player.transform.position;
            return At(pos) ?? encounters.FirstOrDefault(r => r.Members.Contains(player.userID))
                ?? encounters.OrderBy(r => (r.Center - pos).sqrMagnitude).FirstOrDefault();
        }

        private bool SpaceAvailable(Vector3 pos) => encounters.All(r =>
            (new Vector2(r.Center.x - pos.x, r.Center.z - pos.z)).sqrMagnitude > Mathf.Pow(2 * Radius + 10f, 2));

        private readonly HashSet<ulong> pendingGuardCorpses = new HashSet<ulong>();
        private void OnEntityDeath(ScientistNPC npc, HitInfo info)
        {
            if (npc == null || !encounters.Any(r => r.Guards.Contains(npc))) return;
            ulong id = npc.userID;
            if (id != 0 && pendingGuardCorpses.Add(id)) timer.Once(30f,() => pendingGuardCorpses.Remove(id));
        }

        private void OnEntitySpawned(NPCPlayerCorpse corpse)
        {
            if (corpse == null || !pendingGuardCorpses.Remove(corpse.playerSteamID)) return;
            NextTick(() =>
            {
                if (corpse == null || corpse.IsDestroyed) return;
                if (corpse.containers != null) foreach (var container in corpse.containers) container?.Clear();
                corpse.Kill();
            });
        }

        private sealed class Preview
        {
            public readonly List<BaseEntity> Entities = new List<BaseEntity>();
            public int Id;
            public string SubmissionId;
            public WebLoot CatalogLoot;
            public Action Cancel;
            public bool Finished;
            public readonly List<BaseEntity> PlayerBuilt = new List<BaseEntity>();
            public bool Playable;
            public bool Automatic;
            public bool Practice;
            public string Tier = "Easy";
            public readonly HashSet<ulong> CooldownMembers = new HashSet<ulong>();
            public string Reward = "Physical";
            public readonly HashSet<BaseEntity> Walls = new HashSet<BaseEntity>();
            public List<ulong> RewardMembers = new List<ulong>();
            public VendingMachineMapMarker Pin;
            public string PinText;
            public string BuilderCredit;
            public SphereEntity Dome;
            public SphereEntity BoundaryRing;
            public string Phase = "Pasting";
            public string Name;
            public string Snapshot;
            public Vector3 Center;
            public readonly HashSet<BaseEntity> Objectives = new HashSet<BaseEntity>();
            public readonly HashSet<ulong> Members = new HashSet<ulong>();
            public double Deadline;
            public int OriginalCount;
            public readonly HashSet<BaseEntity> Guards = new HashSet<BaseEntity>();
            public float NextGuardCheck;
            public string Attackers, Defenders;
            public int CombatMinutes;
            public BuildingPrivlidge SiegeCupboard;
            public readonly HashSet<ulong> Defending = new HashSet<ulong>();
            public readonly HashSet<ulong> Attacking = new HashSet<ulong>();
            public readonly HashSet<ulong> Votes = new HashSet<ulong>();
            public readonly Dictionary<ulong, Vector3> LastInside = new Dictionary<ulong, Vector3>();
            public bool Event;
            public string EventId;
            public readonly HashSet<ulong> Registered = new HashSet<ulong>();
            public bool IsSiege => Attackers != null;
        }

        private void Audit(BasePlayer actor, string action, string detail, Preview preview = null)
        {
            var record = new { utc = DateTime.UtcNow, actor = actor == null ? "server" : actor.UserIDString,
                action, detail, encounterId = preview?.Id, encounter = preview?.Name, phase = preview?.Phase };
            LogToFile("audit", JsonConvert.SerializeObject(record), this, true);
        }

        private void Init()
        {
            permission.RegisterPermission(AdminPermission, this);
            permission.RegisterPermission("reraid.panel", this);
            state = Interface.Oxide.DataFileSystem.ReadObject<Saved>("RERaid_State") ?? new Saved();
            foreach (var interrupted in state.Submissions.Values.Where(x => x.Status == "Copying")) interrupted.Status = "Snapshot failed";
            timer.Every(2f, Tick);
            timer.Every(1f, RefreshHud);
            timer.Every(10f, Publish);
            timer.Every(5f, DeliverCredits);
            timer.Every(60f, Rotate);
        }

        [ChatCommand("reraid")]
        private void RaidCommand(BasePlayer player, string command, string[] args)
        {
            if (args.Length == 0)
            {
                ShowRaidPanel(player);
                if (CanManagePreviews(player))
                    SendReply(player, "/reraid spawn <CopyPaste name> | /reraid preview <CopyPaste name> and /reraid clearpreview");
                return;
            }

            var preview = ForPlayer(player);
            switch (args[0].ToLowerInvariant())
            {
                case "list":
                    SendReply(player, encounters.Count == 0 ? "No encounters." : string.Join("\n", encounters.Select(r => $"#{r.Id} {r.Name} | {Grid(r.Center)} | {r.Phase}")));
                    break;
                case "admin":
                    AdminCommand(player,args);
                    break;
                case "stats":
                    var stats = Stats(player.userID);
                    state.Completions.TryGetValue(player.userID, out int total);
                    SendReply(player, $"Lifetime raids: {total} completions, {stats.Failures} failures, {stats.Deaths} deaths, {stats.PaidRP} RP credited.");

                    break;
                case "playtest":
                    JoinTest(player,args);
                    break;
                case "feedback":
                    Feedback(player,args);
                    break;
                case "revision":
                case "submit":
                    Submit(player,args);
                    break;
                case "web":
                    if (args.Length != 2 || !state.Submissions.TryGetValue(args[1], out var webEntry) ||
                        webEntry.Builder != player.userID || webEntry.Status == "Copying" || webEntry.Status == "Snapshot failed")
                    { SendReply(player, "To request a new import code, find your completed base with /reraid review, then run /reraid web <submission ID>."); return; }
                    RequestSubmissionPhoto(player, args[1]);
                    return;
                case "review":
                    Review(player,args);
                    break;
                case "loot":
                    SimulateLoot(player,args);
                    break;
                case "gamble":
                    Gamble(player, args);
                    break;
                case "event":
                    if (!CanManagePreviews(player) || args.Length < 4 || !int.TryParse(args[2], out int minutes) || minutes < 1 || minutes > 1440)
                    { SendReply(player, "Staff usage: /reraid event <id> <active minutes> <paste name>"); return; }
                    StartPreview(player, new[] { "spawn" }.Concat(args.Skip(3)).ToArray(), r =>
                    { r.Event = true; r.EventId = args[1]; r.CombatMinutes = minutes; });
                    break;
                case "status":
                    SendReply(player, Status(preview));
                    break;
                case "surrender":
                    if (preview != null && preview.Phase == "Active" && preview.Members.Contains(player.userID)) EndRaid(preview,"surrendered");
                    else SendReply(player, "You have no active raid to surrender.");
                    break;
                case "siege":
                    SiegeCommand(player, command, args.Skip(1).ToArray());
                    break;
                case "seige":
                    SiegeTypo(player, command, args);
                    break;
                case "spawn":
                case "preview":
                case "clearpreview":
                    if (!CanManagePreviews(player))
                    {
                        SendReply(player, "You do not have permission to manage raid previews.");
                        return;
                    }

                    if (!args[0].Equals("clearpreview", StringComparison.OrdinalIgnoreCase))
                        {
                            if (args[0].Equals("spawn", StringComparison.OrdinalIgnoreCase) && args.Length >= 3 && Tiers.Contains(args[1], StringComparer.OrdinalIgnoreCase))
                                StartPreview(player, new[] { "spawn" }.Concat(args.Skip(2)).ToArray(), r => r.Tier = Tiers.First(t => t.Equals(args[1], StringComparison.OrdinalIgnoreCase)));
                            else StartPreview(player, args);
                        }
                    else if (args.Length == 1)
                    {
                        preview = At(player.transform.position) ?? (encounters.Count == 1 ? encounters[0] : null);
                        if (preview == null) { SendReply(player,"Select an encounter with /reraid admin end <ID>."); return; }
                        Audit(player,"clear",preview.Name,preview);
                        SendReply(player, ClearPreview(preview) ? "Encounter removed." : "There is no encounter.");
                    }
                    else
                        SendReply(player, "Usage: /reraid clearpreview");
                    break;
                default:
                    SendReply(player, "Unknown raid command. Use /reraid to see current raids or /reraid submit for builder instructions.");
                    break;
            }
        }

        [ChatCommand("siege")]
        private void SiegeCommand(BasePlayer player, string command, string[] args)
        {
            var preview = encounters.Where(r => r.IsSiege).OrderByDescending(r => r.Members.Contains(player.userID)).ThenBy(r => (r.Center-player.transform.position).sqrMagnitude).FirstOrDefault();
            if (args.Length == 0)
            {
                SendReply(player, preview != null && preview.IsSiege ? Status(preview) : "No siege is scheduled.");
                if (CanManagePreviews(player)) SendReply(player, "/siege start <attacker clan> <defender clan> <prep minutes> <combat minutes> <paste name>");
                return;
            }
            if (args[0].Equals("register", StringComparison.OrdinalIgnoreCase))
            {
                var r = args.Length == 3 ? encounters.FirstOrDefault(e => e.Event && e.EventId == args[2]) : null;
                if (args.Length != 3 || r == null || !r.Event || r.Phase != "Event preparation" || r.EventId != args[2])
                { SendReply(player, "Registration unavailable. Use /siege register grub <event ID> or ask staff to register your clan."); return; }
                if (args[1].Equals("grub", StringComparison.OrdinalIgnoreCase)) r.Registered.Add(player.userID);
                else
                {
                    if (!CanManagePreviews(player)) { SendReply(player, "Clan registration requires staff verification."); return; }
                    var members = ClanRoster(args[1]);
                    if (members.Count == 0) { SendReply(player, "Clan not found."); return; }
                    r.Registered.UnionWith(members);
                }
                SendReply(player, "Registration recorded.");
                return;
            }
            if (args[0].Equals("forfeit", StringComparison.OrdinalIgnoreCase))
            {
                var raid = preview;
                if (raid == null || !raid.IsSiege || raid.Phase != "Combat" || !raid.Members.Contains(player.userID)) { SendReply(player, "You have no active siege vote."); return; }
                var side = raid.Attacking.Contains(player.userID) ? raid.Attacking : raid.Defending;
                raid.Votes.Add(player.userID);
                int count = side.Count(raid.Votes.Contains);
                SendReply(player, $"Forfeit votes: {count}/{side.Count / 2 + 1} required.");
                if (count > side.Count / 2) SiegeVictory(raid, side == raid.Attacking ? raid.Defending : raid.Attacking);
                return;
            }
            if (!CanManagePreviews(player) || args.Length < 6 || !args[0].Equals("start", StringComparison.OrdinalIgnoreCase)
                || !int.TryParse(args[3], out int prep) || !int.TryParse(args[4], out int combat)
                || prep < 1 || combat < 1 || prep > 1440 || combat > 1440)
            { SendReply(player, "Use /siege for siege status and available commands."); return; }
            var attackers = ClanRoster(args[1]);
            var defenders = ClanRoster(args[2]);
            if (attackers.Count == 0 || defenders.Count == 0 || attackers.Overlaps(defenders)) { SendReply(player, "Two distinct populated clans are required."); return; }
            StartPreview(player, new[] { "spawn" }.Concat(args.Skip(5)).ToArray(), pending =>
            {
                pending.Attackers = args[1]; pending.Defenders = args[2];
                pending.Attacking.UnionWith(attackers); pending.Defending.UnionWith(defenders);
                pending.Members.UnionWith(attackers); pending.Members.UnionWith(defenders);
                pending.CombatMinutes = combat;
                pending.Deadline = prep * 60;
            });
        }

        [ChatCommand("seige")]
        private void SiegeTypo(BasePlayer player, string command, string[] args)
        {
            SendReply(player, "Did you mean siege?");
        }

        private void AdminCommand(BasePlayer player, string[] args)
        {
            if (args.Length == 3 && args[1] == "webtest" && Guid.TryParseExact(args[2], "N", out _))
            {
                if (!CanManagePreviews(player) && !permission.UserHasPermission(player.UserIDString,"reraid.panel")) { SendReply(player,"Panel access required."); return; }
                string revisionId = args[2];
                CatalogRequest("/test/" + revisionId, null, true, (code, body) =>
                {
                    if (player == null || !player.IsConnected) return;
                    if (code != 200) { Respond(player, "Playtest download failed (" + code + "). Check CatalogEndpoint and CatalogPublishToken."); return; }
                    try
                    {
                        var response = Newtonsoft.Json.Linq.JObject.Parse(body);
                        var item = response.ToObject<CatalogItem>();
                        var data = response["data"] as Newtonsoft.Json.Linq.JObject;
                        if (item.id != revisionId || !Tiers.Contains(item.tier) || !(data?["entities"] is Newtonsoft.Json.Linq.JArray entities) || entities.Count == 0)
                            throw new Exception("Invalid review snapshot");
                        string filename = "re_review_" + revisionId;
                        Interface.Oxide.DataFileSystem.WriteObject("copypaste/" + filename, data);
                        StartPreview(player, new[] { "spawn", filename }, r => {
                            r.Name = item.name; r.Tier = item.tier; r.CatalogLoot = item.loot;
                            r.Practice = true; r.SubmissionId = revisionId; r.Members.Add(player.userID);
                        });
                    }
                    catch (Exception ex) { Respond(player, "Playtest failed: " + ex.Message); }
                });
                return;
            }
            if (!CanManagePreviews(player)) { SendReply(player,"Raid admin permission required."); return; }
            if (args.Length==2 && args[1]=="claimcheck")
            {
                var at = At(player.transform.position);
                string aimed = "No entity under crosshair.";
                if (Physics.Raycast(player.eyes.HeadRay(),out RaycastHit sight,100f,LayerMask.GetMask("Construction","Deployed"),QueryTriggerInteraction.Ignore))
                {
                    var target=sight.GetEntity();
                    var owner=target==null ? null : encounters.FirstOrDefault(r=>r.Entities.Contains(target));
                    aimed=$"Target {target?.ShortPrefabName}: {(owner==null ? "untracked" : "raid #"+owner.Id)}.";
                }
                lastClaimHit.TryGetValue(player.userID,out var last);
                SendReply(player,$"Inside: {(at==null ? "none" : "#"+at.Id)}. {aimed} Last raid hit: {last ?? "none observed this session"}");
                return;
            }
            if (args.Length == 3 && args[1] == "push") { Audit(player,"catalog push",args[2]); PushPublication(player,args[2]); return; }
            if (args.Length == 2 && args[1] == "pull") { Audit(player,"catalog pull",""); PullPublications(player); return; }
            if (args.Length >= 2 && args[1].Equals("clearcooldown",StringComparison.OrdinalIgnoreCase))
            {
                ulong target = player.userID;
                if (args.Length > 3 || (args.Length == 3 && !ulong.TryParse(args[2],out target))) { SendReply(player,"Use /reraid admin clearcooldown [Steam ID]."); return; }
                bool removed = state.Cooldowns.Remove(target);
                Save();
                Audit(player,"clearcooldown",target + " removed=" + removed);
                RefreshHud();
                SendReply(player,removed ? $"Cooldown cleared for {target}." : $"No cooldown recorded for {target}.");
                return;
            }
            if (args.Length == 2 && args[1] == "payments")
            {
                SendReply(player,state.Credits.Count == 0 ? "No outstanding RP payments." : string.Join("\n",state.Credits.Take(12).Select(c => $"{c.Id} {c.Player} {c.Amount} RP | {(c.Attempted ? "verify balance" : "queued")}")));
                return;
            }
            if (args.Length == 4 && args[1]=="payment" && (args[3]=="paid" || args[3]=="retry"))
            {
                var credit=state.Credits.FirstOrDefault(c => c.Id==args[2] && c.Attempted);
                if (credit==null) { SendReply(player,"No uncertain payment with that ID."); return; }
                Audit(player,"payment "+args[3],JsonConvert.SerializeObject(credit));
                if (args[3]=="retry") credit.Attempted=false;
                else { Stats(credit.Player).PaidRP+=credit.Amount; state.Credits.Remove(credit); }
                Save();
                SendReply(player,"Payment reconciliation saved.");
                return;
            }
            if (args.Length == 3 && args[1].Equals("end",StringComparison.OrdinalIgnoreCase) && int.TryParse(args[2],out int id))
            {
                var raid = encounters.FirstOrDefault(r => r.Id == id);
                if (raid == null) { SendReply(player,"Unknown encounter ID."); return; }
                Audit(player,"end",raid.Name,raid);
                ClearPreview(raid);
                SendReply(player,$"Removed encounter #{id}.");
                return;
            }
            SendReply(player,"/reraid list | /reraid admin end <ID> | /reraid admin clearcooldown [Steam ID]");
        }

        private bool CanManagePreviews(BasePlayer player)
        {
            return player.IsAdmin || permission.UserHasPermission(player.UserIDString, AdminPermission);
        }

        private HashSet<ulong> ClanRoster(string tag)
        {
            var clan = Clans?.Call("GetClan", tag) as Newtonsoft.Json.Linq.JObject;
            var roster = new HashSet<ulong>();
            var members = clan?["members"] as Newtonsoft.Json.Linq.JArray;
            if (members != null) foreach (var value in members) if (ulong.TryParse(value.ToString(), out ulong id)) roster.Add(id);
            return roster;
        }

        private const string Hud = "RERaid.Hud";
        private readonly Dictionary<ulong,string> hudText = new Dictionary<ulong,string>();

        private void RefreshHud()
        {
            foreach (var player in BasePlayer.activePlayerList)
            {
                string line = "";
                if (state.Cooldowns.TryGetValue(player.userID,out double until) && until > Now)
                    line = $"Raid cooldown   {Math.Ceiling((until - Now) / 60)} min";
                var raid = At(player.transform.position);
                CheckBruhEntry(player, raid);
                if (openRaidPanels.TryGetValue(player.userID, out var panel) && panel.Raid != raid)
                    ShowRaidPanel(player, panel.Page);
                if (raid != null && raid.Finished && raid.Playable && (raid.Members.Contains(player.userID) || raid.Registered.Contains(player.userID)))
                    line = Status(raid) + (raid.IsSiege || raid.Event ? "" : " | Reward: " + (raid.Reward == "Physical" ? "Raid loot" : raid.Reward == "RP" ? "RP roll" : "Undecided"));
                if (hudText.TryGetValue(player.userID,out string previous) && previous == line) continue;
                hudText[player.userID] = line;
                CuiHelper.DestroyUi(player,Hud);
                if (line.Length == 0) continue;
                var ui = new CuiElementContainer();
                ui.Add(new CuiLabel { Text = {Text=line, FontSize=13, Align=TextAnchor.MiddleCenter},
                    RectTransform = {AnchorMin="0.22 0.92",AnchorMax="0.78 0.97"} }, "Hud", Hud);
                CuiHelper.AddUi(player,ui);
            }
        }

        // User-supplied Bruh entry clip, encoded as 100 ms Steam voice packets.
        private static readonly string[] BruhVoicePackets =
        {
            "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",
        };

        private readonly Dictionary<ulong, Preview> bruhEntries = new Dictionary<ulong, Preview>();
        private readonly Dictionary<ulong, BasePlayer> bruhSpeakers = new Dictionary<ulong, BasePlayer>();

        private void CheckBruhEntry(BasePlayer player, Preview raid)
        {
            if (player.IsDead() || raid == null || !raid.Finished || !raid.Playable ||
                raid.Event || raid.IsSiege || raid.Tier != "Bruh")
            {
                bruhEntries.Remove(player.userID);
                return;
            }

            if (bruhEntries.TryGetValue(player.userID, out var previous) && previous == raid) return;
            bruhEntries[player.userID] = raid;
            if (!bruhSpeakers.ContainsKey(player.userID)) PlayBruhEntry(player);
        }

        private void RemoveBruhSpeaker(ulong listenerId)
        {
            if (!bruhSpeakers.TryGetValue(listenerId, out var speaker)) return;
            bruhSpeakers.Remove(listenerId);
            if (speaker != null && !speaker.IsDestroyed) speaker.Kill();
        }

        private void PlayBruhEntry(BasePlayer listener)
        {
            var position = listener.transform.position;
            position.y = Math.Min(position.y, TerrainMeta.HeightMap.GetHeight(position)) - 3f;
            var speaker = GameManager.server.CreateEntity("assets/prefabs/player/player.prefab",
                position, Quaternion.identity) as BasePlayer;
            if (speaker == null) return;
            ulong listenerId = listener.userID;
            try
            {
                speaker.enableSaving = false;
                speaker.Spawn();
                speaker.enableSaving = false;
                speaker.currentTeam = ulong.MaxValue;
                bruhSpeakers[listenerId] = speaker;
            }
            catch (Exception ex)
            {
                if (!speaker.IsDestroyed) speaker.Kill();
                PrintWarning("Bruh raid voice source failed to spawn: " + ex.Message);
                return;
            }

            // Let the client initialize the speaker before the first packet.
            timer.Once(1f, () =>
            {
                int index = 0;
                Oxide.Plugins.Timer stream = null;
                stream = timer.Repeat(0.1f, BruhVoicePackets.Length, () =>
                {
                    if (!bruhSpeakers.TryGetValue(listenerId, out var active) || active != speaker)
                    {
                        stream.Destroy();
                        return;
                    }
                    if (!listener.IsConnected || listener.IsDead() || speaker == null || speaker.IsDestroyed || speaker.net == null)
                    {
                        stream.Destroy();
                        RemoveBruhSpeaker(listenerId);
                        return;
                    }

                    try
                    {
                        byte[] packet = Convert.FromBase64String(BruhVoicePackets[index++]);
                        StampBruhVoiceIdentity(packet, listenerId);
                        var writer = Network.Net.sv.StartWrite();
                        writer.PacketID(Network.Message.Type.VoiceData);
                        writer.EntityID(speaker.net.ID);
                        writer.BytesWithSize(packet);
                        writer.Send(new Network.SendInfo(listener.Connection) { priority = Network.Priority.Immediate });
                        if (index == BruhVoicePackets.Length)
                            timer.Once(1f, () =>
                            {
                                if (bruhSpeakers.TryGetValue(listenerId, out var lastSpeaker) && lastSpeaker == speaker)
                                    RemoveBruhSpeaker(listenerId);
                            });
                    }
                    catch (Exception ex)
                    {
                        stream.Destroy();
                        RemoveBruhSpeaker(listenerId);
                        PrintWarning("Bruh raid voice playback failed: " + ex.Message);
                    }
                });
            });
        }

        private static void StampBruhVoiceIdentity(byte[] packet, ulong steamId)
        {
            for (int i = 0; i < 8; i++) packet[i] = (byte)(steamId >> (8 * i));
            int checksumOffset = packet.Length - 4;
            uint crc = 0xffffffffu;
            for (int i = 0; i < checksumOffset; i++)
            {
                crc ^= packet[i];
                for (int bit = 0; bit < 8; bit++)
                    crc = (crc >> 1) ^ ((crc & 1u) != 0 ? 0xedb88320u : 0u);
            }
            crc ^= 0xffffffffu;
            for (int i = 0; i < 4; i++) packet[checksumOffset + i] = (byte)(crc >> (8 * i));
        }

        private readonly Dictionary<ulong,string> lastClaimHit = new Dictionary<ulong,string>();
        private readonly Dictionary<ulong,float> nextClaimHint = new Dictionary<ulong,float>();
        private void OnPlayerDisconnected(BasePlayer player, string reason)
        {
            hudText.Remove(player.userID);
            pendingSubmissionPhotos.Remove(player.userID);
            bruhEntries.Remove(player.userID);
            RemoveBruhSpeaker(player.userID);
            openRaidPanels.Remove(player.userID);
            lastClaimHit.Remove(player.userID);
            nextClaimHint.Remove(player.userID);
        }

        private void ClaimHint(BasePlayer player, Preview raid, string message)
        {
            if (player == null || player.IsNpc || raid.Phase != "Available") return;
            string line = $"Raid #{raid.Id}: {message}";
            lastClaimHit[player.userID] = line;
            if (nextClaimHint.TryGetValue(player.userID,out float next) && Time.realtimeSinceStartup < next) return;
            nextClaimHint[player.userID] = Time.realtimeSinceStartup + 2f;
            SendReply(player,line);
        }

        private const string Panel = "RERaid.Status";
        private readonly Dictionary<ulong, (int Page, Preview Raid)> openRaidPanels = new Dictionary<ulong, (int, Preview)>();

        [ConsoleCommand("reraid.close")]
        private void CloseRaidPanel(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if (player == null) return;
            openRaidPanels.Remove(player.userID);
            CuiHelper.DestroyUi(player, Panel);
        }

        [ConsoleCommand("reraid.page")]
        private void PageCommand(ConsoleSystem.Arg arg)
        {
            var player = arg.Player();
            if (player != null) ShowRaidPanel(player,arg.GetInt(0,0));
        }

        private void ShowRaidPanel(BasePlayer player, int page = 0)
        {
            CuiHelper.DestroyUi(player, Panel);
            var ui = new CuiElementContainer();
            ui.Add(new CuiPanel
            {
                Image = { Color = "0.10 0.13 0.14 0.96" },
                RectTransform = { AnchorMin = "0.20 0.21", AnchorMax = "0.80 0.79" },
                CursorEnabled = true
            }, "Overlay", Panel);
            var raid = At(player.transform.position);
            var visible = encounters.Where(r => r.Playable || CanManagePreviews(player)).OrderBy(r => r.Id).ToList();
            const int pageSize = 6;
            int pages = Math.Max(1,(visible.Count + pageSize - 1) / pageSize);
            page = Mathf.Clamp(page,0,pages-1);
            openRaidPanels[player.userID] = (page, raid);
            string rows = string.Join("\n",visible.Skip(page*pageSize).Take(pageSize).Select(r =>
                $"#{r.Id}   {Grid(r.Center)}   {r.Name}   |   {(r.IsSiege ? "Siege" : r.Event ? "Event" : r.Practice ? "Playtest" : r.Playable ? r.Tier : "Preview")}   |   {r.Phase}"));
            string title = $"RUST EMPIRES RAIDS   ({visible.Count})\n{rows}";
            if (raid != null && visible.Contains(raid)) title += $"\n\nRaid details: {Status(raid)}";

            if (state.Cooldowns.TryGetValue(player.userID, out double until) && until > Now)
                title += $"\nYour cooldown: {Math.Ceiling((until - Now) / 60)} minutes";
            else if (raid != null && raid.Finished && raid.Playable && !raid.Event && !raid.IsSiege)
            {
                bool member = raid.Members.Contains(player.userID);
                switch (raid.Phase)
                {
                    case "Available":
                        title += "\nDamage the base or compound to claim it.";
                        break;
                    case "Active":
                        title += member ? "\nDestroy the remaining original objectives to finish." : "\nThis raid has been claimed.";
                        break;
                    case "Recovery":
                        title += member ? "\nRaid complete. Recover your loot before cleanup." : "\nRecovery is reserved for raid participants.";
                        break;
                }
            }
            ui.Add(new CuiLabel { Text = { Text = title, FontSize = 15, Align = TextAnchor.MiddleCenter },
                RectTransform = { AnchorMin = "0.04 0.23", AnchorMax = "0.96 0.97" } }, Panel);
            ui.Add(new CuiButton { Button = { Command = "reraid.close", Color = "0.28 0.35 0.30 1" }, Text = { Text = "Close", FontSize = 14, Align = TextAnchor.MiddleCenter },
                RectTransform = { AnchorMin = "0.38 0.04", AnchorMax = "0.62 0.22" } }, Panel);
            if (page > 0) ui.Add(new CuiButton { Button = {Command=$"reraid.page {page-1}"}, Text={Text="Previous",FontSize=14,Align=TextAnchor.MiddleCenter},
                RectTransform={AnchorMin="0.08 0.04",AnchorMax="0.30 0.22"} },Panel);
            if (page+1 < pages) ui.Add(new CuiButton { Button = {Command=$"reraid.page {page+1}"}, Text={Text="Next",FontSize=14,Align=TextAnchor.MiddleCenter},
                RectTransform={AnchorMin="0.70 0.04",AnchorMax="0.92 0.22"} },Panel);
            CuiHelper.AddUi(player, ui);
        }

        private void SiegeVictory(Preview raid, HashSet<ulong> winners)
        {
            raid.Phase = "Siege recovery";
            raid.Members.Clear();
            raid.Members.UnionWith(winners);
            raid.Deadline = Now + 1800;
            Announce($"{(winners == raid.Attacking ? raid.Attackers : raid.Defenders)} won {raid.Name}. Recovery lasts 30 minutes.");
        }

        private void OnPlayerRespawned(BasePlayer player) { foreach (var raid in encounters) raid.LastInside.Remove(player.userID); }

        private void Rotate()
        {
            foreach (var entry in state.Submissions.Values.Where(x => x.Status == "Approved" && x.ApprovedAt + 604800 <= Now)) PublishBase(entry);
            if (encounters.Count(r => r.Automatic) >= Math.Max(0,Convert.ToInt32(Config["AutomaticRaidSlots"] ?? 1)) || !Convert.ToBoolean(Config["EnableAutomaticRaids"] ?? false) || CopyPaste == null) return;
            var pool = ReadConfigSection<Dictionary<string,string>>("BasePool");
            if (pool == null || pool.Count == 0) return;
            int wipeDay = 1 + Math.Max(0,(int)(DateTime.UtcNow - SaveRestore.SaveCreatedTime.ToUniversalTime()).TotalDays);
            var candidates = pool.Keys.Where(n => PasteName.IsMatch(n) && Tiers.Contains(pool[n]) &&
                rules.TryGetValue(pool[n],out var tier) && wipeDay >= tier.UnlockDay &&
                encounters.Count(e => e.Automatic && e.Tier == pool[n]) < tier.AutomaticSlots).ToList();
            if (candidates.Count == 0) return;
            string name = candidates.OrderBy(n => state.Rotation.LastIndexOf(n)).ThenBy(n => UnityEngine.Random.value).First();
            for (int attempt = 0; attempt < 12; attempt++)
            {
                float extent = TerrainMeta.Size.x * 0.42f;
                var point = TerrainMeta.Position + TerrainMeta.Size * 0.5f + new Vector3(UnityEngine.Random.Range(-extent, extent),0,UnityEngine.Random.Range(-extent,extent));
                point.y = TerrainMeta.HeightMap.GetHeight(point);
                if (point.y < TerrainMeta.WaterMap.GetHeight(point) + 2f || BasePlayer.activePlayerList.Any(p => Vector3.Distance(point,p.transform.position) < Radius + 30)) continue;
                if (TerrainMeta.Path.Monuments.Any(m => m != null && Vector3.Distance(point, m.transform.position) < Radius + 180f)) continue;
                if (Physics.CheckSphere(point, Radius, LayerMask.GetMask("Construction", "Deployed", "World", "Prevent Building"))) continue;
                bool usable = true;
                foreach (var offset in new[] {Vector3.left,Vector3.right,Vector3.forward,Vector3.back})
                {
                    var edge = point + offset * Radius;
                    if (Math.Abs(TerrainMeta.HeightMap.GetHeight(edge) - point.y) > 4f || TerrainMeta.HeightMap.GetHeight(edge) <= TerrainMeta.WaterMap.GetHeight(edge)) usable = false;
                }
                if (!usable || !SpaceAvailable(point)) continue;
                StartPreview(null, new[] { "spawn", name }, r => { r.Tier = pool[name]; r.Automatic = true; }, point);
                break;
            }
        }

        private void Respond(BasePlayer player, string message)
        {
            if (player != null && player.IsConnected) SendReply(player, message);
            else Puts(message);
        }

        private void StartPreview(BasePlayer player, string[] args, Action<Preview> configure = null, Vector3? location = null)
        {
            string filename = string.Join(" ", args, 1, args.Length - 1);
            if (!PasteName.IsMatch(filename))
            {
                Respond(player, "Usage: /reraid preview <CopyPaste name without .json>");
                return;
            }

            if (CopyPaste == null || !CopyPaste.IsLoaded)
            {
                Respond(player, "Load CopyPaste before starting a raid preview.");
                return;
            }

            Preview pending = new Preview { Name = filename, Snapshot = filename, Playable = args[0].Equals("spawn", StringComparison.OrdinalIgnoreCase) };
            configure?.Invoke(pending);
            float yaw = player == null ? 0f : player.GetNetworkRotation().eulerAngles.y;
            Vector3 forward = Quaternion.Euler(0f, yaw, 0f) * Vector3.forward;
            Vector3 position = location ?? (player.transform.position + forward * 15f);
            pending.Center = position;
            if (!SpaceAvailable(position)) { Respond(player,"Choose a location farther from existing raid bubbles."); return; }
            if (pending.Event && encounters.Any(r => r.Event && r.EventId == pending.EventId)) { Respond(player,"Event ID already in use."); return; }
            pending.Id = ++nextId;
            encounters.Add(pending);
            Audit(player, args[0], filename,pending);
            Action finished = () =>
            {
                if (!encounters.Contains(pending))
                    return;

                pending.Finished = true;
                if (pending.Playable)
                {
                    PrepareRaid(pending);
                    return;
                }
                string message = $"Raid preview '{filename}' pasted. Tracked {pending.Entities.Count} entities.";
                Puts(message);
                if (player != null && player.IsConnected)
                    Respond(player, message);
            };
            Action<BaseEntity> spawned = entity =>
            {
                if (encounters.Contains(pending))
                    pending.Entities.Add(entity);
                else if (entity != null && !entity.IsDestroyed)
                    entity.Kill();
            };

            string[] options = { "enablesaving", "false", "auth", "false", "entityowner", "false",
                "inventories", "false", "blockcollision", "1", "autoheight", "true" };
            float rotation = yaw * Mathf.Deg2Rad;
            object result = CopyPaste.Call("TryPasteFromVector3Cancellable", position, rotation,
                filename, options, finished, spawned, 0);

            if (!(result is ValueTuple<object, Action> paste) || !Equals(paste.Item1, true))
            {
                ClearPreview(pending);
                string error = result is ValueTuple<object, Action> rejected ? rejected.Item1 as string : null;
                Respond(player, error ?? "CopyPaste did not accept the preview.");
                return;
            }

            pending.Cancel = paste.Item2;
            Respond(player, $"Raid preview '{filename}' queued 15 m ahead.");
            timer.Once(120f, () =>
            {
                if (!encounters.Contains(pending) || pending.Finished)
                    return;

                ClearPreview(pending);
                PrintWarning($"Raid preview '{filename}' timed out and was removed.");
                if (player != null && player.IsConnected)
                    Respond(player, "The raid preview timed out and was removed.");
            });
        }

        private bool ClearPreview(Preview current)
        {
            if (current == null || !encounters.Remove(current))
                return false;

            if (!current.Finished)
                current.Cancel?.Invoke();

            current.Entities.AddRange(current.PlayerBuilt);
            for (int i = current.Entities.Count - 1; i >= 0; i--)
            {
                BaseEntity entity = current.Entities[i];
                if (entity != null && !entity.IsDestroyed)
                    entity.Kill();
            }

            return true;
        }

        private sealed class WebLoot
        {
            public int Rolls;
            public List<LootEntry> Entries, Guaranteed;
        }

        private sealed class CatalogItem
        {
            public string id, family, name, tier;
            public WebLoot loot;
            public int revision;
        }

        private void CatalogRequest(string suffix, string payload, bool publish, Action<int,string> callback)
        {
            string endpoint = Config["CatalogEndpoint"] as string;
            string token = Config[publish ? "CatalogPublishToken" : "CatalogReadToken"] as string;
            if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(token))
            {
                callback(0,"Configure CatalogEndpoint and the corresponding catalog token.");
                return;
            }
            webrequest.Enqueue(endpoint.TrimEnd('/') + suffix,payload,callback,this,
                payload != null ? Oxide.Core.Libraries.RequestMethod.POST : Oxide.Core.Libraries.RequestMethod.GET,
                new Dictionary<string,string> { {"Authorization","Bearer " + token},{"Content-Type","application/json"} },60f);
        }

        private void PushPublication(BasePlayer player,string id)
        {
            if (!state.Submissions.TryGetValue(id,out var entry) || entry.Status != "Published")
            { Respond(player,"Only a published submission can be distributed."); return; }
            var files=Interface.Oxide.DataFileSystem;
            string path="copypaste/" + entry.Snapshot;
            if (!files.ExistsDatafile(path)) { Respond(player,"Published snapshot is missing."); return; }
            var data=files.ReadObject<Newtonsoft.Json.Linq.JObject>(path);
            string family=id;
            var ancestor=entry;
            while (ancestor.ParentId != null && state.Submissions.TryGetValue(ancestor.ParentId,out var prior))
            { family=ancestor.ParentId; ancestor=prior; }
            var envelope=new {id,family,revision=entry.Revision,name=entry.Name,tier=entry.Tier,data};
            CatalogRequest("",JsonConvert.SerializeObject(envelope),true,(code,body) =>
                Respond(player,code==200 ? $"Published {entry.Name} revision {entry.Revision} to Raid Center." : $"Catalog publication failed ({code})."));
        }

        private bool syncing;
        private void PullPublications(BasePlayer player)
        {
            if (syncing) { Respond(player,"A catalog sync is already running."); return; }
            syncing=true;
            CatalogRequest("",null,false,(code,body) =>
            {
                try
                {
                    if (code != 200) throw new Exception("catalog HTTP " + code);
                    var manifest=JsonConvert.DeserializeObject<List<CatalogItem>>(body);
                    if (manifest==null || manifest.Any(x=>x==null || !Guid.TryParseExact(x.id,"N",out _) ||
                        !Guid.TryParseExact(x.family,"N",out _) || !Tiers.Contains(x.tier) || x.revision<1))
                        throw new Exception("invalid manifest");
                    FetchNext(player,new Queue<CatalogItem>(manifest));
                }
                catch (Exception ex) { syncing=false; Respond(player,"Sync stopped: "+ex.Message); }
            });
        }

        private void FetchNext(BasePlayer player,Queue<CatalogItem> queue)
        {
            var files=Interface.Oxide.DataFileSystem;
            while (queue.Count>0)
            {
                var item=queue.Dequeue();
                string filename="re_catalog_"+item.id;
                if (state.Catalog.TryGetValue(item.family,out var old) && old.id==item.id && files.ExistsDatafile("copypaste/"+filename)) continue;
                CatalogRequest("/"+item.id,null,false,(code,body) =>
                {
                    try
                    {
                        if (code!=200) throw new Exception("snapshot HTTP "+code);
                        var data=Newtonsoft.Json.Linq.JObject.Parse(body);
                        if (!(data["entities"] is Newtonsoft.Json.Linq.JArray entities) || entities.Count==0) throw new Exception("empty snapshot");
                        files.WriteObject("copypaste/"+filename,data);
                        var pool=ReadConfigSection<Dictionary<string,string>>("BasePool") ?? new Dictionary<string,string>();
                        if (old!=null) pool.Remove("re_catalog_"+old.id);
                        pool[filename]=item.tier;
                        Config["BasePool"]=pool;
                        SaveConfig();
                        state.Catalog[item.family]=item;
                        Save();
                        FetchNext(player,queue);
                    }
                    catch (Exception ex) { syncing=false; Respond(player,"Sync stopped: "+ex.Message); }
                });
                return;
            }
            syncing=false;
            Respond(player,"Catalog sync complete.");
        }

        private sealed class Submission
        {
            public string Name, Tier, Snapshot, Status;
            public string ParentId;
            public int Revision = 1;
            public bool Anonymous;
            public string BuilderName;
            public HashSet<ulong> Collaborators = new HashSet<ulong>();
            public string PlaytestCode;
            public Dictionary<ulong,string> Feedback = new Dictionary<ulong,string>();
            public HashSet<ulong> Testers = new HashSet<ulong>();
            public HashSet<ulong> Accepted = new HashSet<ulong>();
            public ulong Builder;
            public Dictionary<ulong,string> Votes = new Dictionary<ulong,string>();
            public List<string> Discussion = new List<string>();
            public double ApprovedAt;
        }

        private void Submit(BasePlayer player, string[] args)
        {
            bool revision = args[0].Equals("revision", StringComparison.OrdinalIgnoreCase);
            if (args.Length < 3)
            {
                SendReply(player, revision
                    ? "Look at the updated base and type /reraid revision <tier> <submission ID>. Use /reraid review to find your submission ID."
                    : "Aim at a wall or foundation of your base and type /reraid submit Easy Test Base. Replace Easy with your tier and Test Base with your base name.");
                SendReply(player, "Tiers: " + string.Join(", ", Tiers) + ". Take a photo with the Rust camera when prompted to get your Raid Center import code.");
                return;
            }
            if (!Convert.ToBoolean(Config["EnableBuilderSubmissions"] ?? false))
            { SendReply(player, "Submit your base from the creative server. This server has builder submissions turned off."); return; }
            if (CopyPaste == null || !CopyPaste.IsLoaded)
            { SendReply(player, "Base copying is unavailable on this server. Ask staff to check CopyPaste."); return; }

            string tier = Tiers.FirstOrDefault(t => t.Equals(args[1], StringComparison.OrdinalIgnoreCase));
            if (tier == null)
            {
                SendReply(player, "Use one of these tiers after /reraid submit: " + string.Join(", ", Tiers) + ".");
                return;
            }
            string name = string.Join(" ", args.Skip(2)).Trim();
            if (!PasteName.IsMatch(name))
            {
                SendReply(player, "Use a name up to 80 characters with letters, numbers, spaces, dots, hyphens, or underscores. Start with a letter, number, hyphen, or underscore.");
                return;
            }
            Submission prior = null;
            string parentId = null;
            if (revision)
            {
                // /reraid revision <tier> <existing submission ID>
                parentId = name;
                if (!state.Submissions.TryGetValue(parentId,out prior) || prior.Builder != player.userID ||
                    prior.Status == "Copying" || prior.Status == "Pending" || prior.Status == "Approved" ||
                    state.Submissions.Values.Any(x => x.ParentId == parentId && x.Status != "Snapshot failed"))
                { SendReply(player,"Use your latest reviewed submission ID for a revision."); return; }
                name = prior.Name;
            }
            else if (state.Submissions.Values.Any(x => x.Status != "Snapshot failed" && x.Name.Equals(name,StringComparison.OrdinalIgnoreCase)))
            { SendReply(player,"That name exists. Use /reraid revision <tier> <previous submission ID>."); return; }
            string id = Guid.NewGuid().ToString("N");
            string snapshot;
            do { snapshot = "re" + Guid.NewGuid().ToString("N").Substring(0, 6); }
            while (state.Submissions.Values.Any(x => x.Snapshot == snapshot) ||
                Interface.Oxide.DataFileSystem.ExistsDatafile("copypaste/" + snapshot));
            var entry = new Submission {Name=name,Tier=tier,Builder=player.userID,Snapshot=snapshot,Status="Copying",
                ParentId=parentId,Revision=prior == null ? 1 : prior.Revision+1, BuilderName=player.displayName,
                Anonymous=prior!=null && prior.Anonymous, Collaborators=prior==null ? new HashSet<ulong>() : new HashSet<ulong>(prior.Collaborators)};
            state.Submissions.Add(id,entry);
            timer.Once(180f, () =>
            {
                if (entry.Status != "Copying") return;
                entry.Status = "Snapshot failed";
                Save();
                if (player.IsConnected) Respond(player, "The base copy did not finish. Aim at a wall or foundation and retry /reraid submit. If it happens again, contact staff.");
            });
            Save();
            string[] options = { "method", "building", "share", "false" };
            Action finished = () => CompleteSubmission(entry, id, player.IPlayer);
            object result = CopyPaste.Call("TryCopyFromSteamId", player.userID, entry.Snapshot, options, finished);
            if (result == null && entry.Status == "Copying")
                result = CopyPaste.Call("TryCopyFromSteamId", player.userID, entry.Snapshot, options);
            if (result == null && entry.Status == "Copying")
            {
                // Invoke the native command as the builder so CopyPaste enforces its own permissions.
                try
                {
                    var command = CopyPaste.GetType().GetMethod("CmdCopy",
                        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic,
                        null, new[] { typeof(Oxide.Core.Libraries.Covalence.IPlayer), typeof(string), typeof(string[]) }, null);
                    if (command == null) throw new MissingMethodException("CopyPaste.CmdCopy");
                    command.Invoke(CopyPaste, new object[] { player.IPlayer, "copy", new[] { entry.Snapshot, "method", "building", "share", "false" } });
                }
                catch (Exception ex)
                {
                    if (entry.Status == "Copying") { entry.Status = "Snapshot failed"; Save(); }
                    PrintWarning("CopyPaste command fallback failed: " + ex.GetBaseException().Message);
                    Respond(player, "The server could not start copying your base. Ask staff to check RERaid and CopyPaste.");
                }
                return;
            }
            if (!Equals(result, true) && entry.Status == "Copying")
            {
                state.Submissions.Remove(id);
                Save();
                Respond(player, result as string ??
                    $"CopyPaste {CopyPaste.Version} returned no result for either copy signature. Try /copy RERaidProbe method building while aiming at the same block.");
            }
        }

        private void OnCopyFinished(List<object> rawData, string filename, Oxide.Core.Libraries.Covalence.IPlayer player, Vector3 startPos)
        {
            if (player == null || !ulong.TryParse(player.Id, out ulong builder)) return;
            var pending = state.Submissions.FirstOrDefault(x => x.Value.Snapshot == filename &&
                x.Value.Status == "Copying" && x.Value.Builder == builder);
            if (pending.Value != null) CompleteSubmission(pending.Value, pending.Key, player);
        }

        private void CompleteSubmission(Submission entry, string id, Oxide.Core.Libraries.Covalence.IPlayer player)
        {
            if (entry.Status != "Copying") return;
            var files = Interface.Oxide.DataFileSystem;
            string path = "copypaste/" + entry.Snapshot;
            bool saved = files.ExistsDatafile(path) &&
                files.ReadObject<Newtonsoft.Json.Linq.JObject>(path)?["entities"] is Newtonsoft.Json.Linq.JArray entities &&
                entities.Count > 0;
            entry.Status = saved ? "Pending" : "Snapshot failed";
            Save();
            if (!player.IsConnected) return;
            if (saved && player.Object is BasePlayer builder) RequestSubmissionPhoto(builder, id);
            else player.Reply("The copy came back empty. Aim at a wall or foundation and retry. If it happens again, ask staff to check that CopyPaste can save bases.");
        }

        private const string SubmissionCamera = "tool.instant_camera";
        private readonly Dictionary<ulong, string> pendingSubmissionPhotos = new Dictionary<ulong, string>();

        private void RequestSubmissionPhoto(BasePlayer builder, string id)
        {
            if (!builder.inventory.containerMain.itemList.Concat(builder.inventory.containerBelt.itemList)
                .Any(item => item.info.shortname == SubmissionCamera))
            {
                var camera = ItemManager.CreateByName(SubmissionCamera, 1);
                if (camera == null)
                {
                    SendReply(builder, "The server could not give you a Rust camera. Ask staff for help.");
                    return;
                }
                builder.GiveItem(camera);
            }

            pendingSubmissionPhotos[builder.userID] = id;
            SendReply(builder, "Base saved. Equip the Rust camera and take a clear photo of your base to get the Raid Center import code.");
        }

        private void OnPhotoCaptured(PhotoEntity photo, Item item, BasePlayer builder, byte[] image)
        {
            if (builder == null || !pendingSubmissionPhotos.TryGetValue(builder.userID, out string id)) return;
            if (!state.Submissions.TryGetValue(id, out var entry) || entry.Builder != builder.userID)
            {
                pendingSubmissionPhotos.Remove(builder.userID);
                return;
            }
            if (image == null || image.Length < 8 || image.Length > 1024 * 1024)
            {
                SendReply(builder, "That photo could not be used. Try taking it again.");
                return;
            }
            pendingSubmissionPhotos.Remove(builder.userID);
            SendWebImport(builder.IPlayer, entry, id, Convert.ToBase64String(image));
        }

        private void SendWebImport(Oxide.Core.Libraries.Covalence.IPlayer player, Submission entry, string id, string photo)
        {
            var snapshot = Interface.Oxide.DataFileSystem.ReadObject<Newtonsoft.Json.Linq.JObject>("copypaste/" + entry.Snapshot);
            var payload = JsonConvert.SerializeObject(new { name = entry.Name, tier = entry.Tier, data = snapshot, photo });
            CatalogRequest("/import", payload, true, (code, body) =>
            {
                if (!player.IsConnected) return;
                if (code != 200)
                {
                    PrintWarning($"Raid Center import failed for {id} (HTTP {code}).");
                    if (code == 401 || code == 403)
                        player.Reply("Base saved. Ask staff to check the creative server's Raid Center connection.");
                    else if (code == 413)
                        player.Reply("Base saved, but it is too large for Raid Center. Submit a smaller base.");
                    else
                        player.Reply($"Base saved, but Raid Center could not issue a code. Run /reraid web {id} to take another photo and retry.");
                    return;
                }
                var importCode = (string)Newtonsoft.Json.Linq.JObject.Parse(body)["code"];
                player.Reply($"Import code: {importCode} (valid for 24 hours).");
                player.Reply("Go to resil.me/dashboard/raids, open Submit a base, and enter the code. Then click Submit for review.");
            });
        }

        private void JoinTest(BasePlayer player,string[] args)
        {
            var pair = state.Submissions.FirstOrDefault(x => args.Length==2 && x.Value.Status=="Pending" && x.Value.PlaytestCode==args[1]);
            var raid = encounters.FirstOrDefault(r => r.Practice && r.SubmissionId==pair.Key && r.Finished);
            if (raid == null || pair.Value == null) { SendReply(player,"That playtest code did not match an active test. Ask the reviewer who started it for the current code."); return; }
            pair.Value.Testers.Add(player.userID);
            raid.Members.Add(player.userID);
            Save();
            SendReply(player,$"Playtest at {Grid(raid.Center)}. Send feedback with /reraid feedback {pair.Value.PlaytestCode} <observations>.");
        }

        private void Feedback(BasePlayer player,string[] args)
        {
            var entry = state.Submissions.Values.FirstOrDefault(x => args.Length>=3 && x.Status=="Pending" && x.PlaytestCode==args[1]);
            if (entry == null || !entry.Testers.Contains(player.userID) || entry.Accepted.Contains(player.userID))
            { SendReply(player,"Join the active revision playtest before submitting feedback."); return; }
            entry.Feedback[player.userID]=string.Join(" ",args.Skip(2));
            Save();
            SendReply(player,"Feedback saved for panel review.");
        }

        private void Review(BasePlayer player, string[] args)
        {
            bool panel = permission.UserHasPermission(player.UserIDString,"reraid.panel");
            bool staff = CanManagePreviews(player);
            if (args.Length == 1)
            {
                SendReply(player,string.Join("\n",state.Submissions.Where(x => (panel || staff || x.Value.Builder == player.userID || x.Value.Collaborators.Contains(player.userID))).Take(10).Select(x => x.Key + " " + x.Value.Name)));
                return;
            }
            if (!state.Submissions.TryGetValue(args[1],out var entry)) { SendReply(player,"Unknown submission."); return; }
            bool owner = entry.Builder == player.userID;
            bool collaborator=entry.Collaborators.Contains(player.userID);
            if (!panel && !staff && !owner && !collaborator) { SendReply(player,"This submission is private."); return; }
            if (args.Length == 2)
            {
                SendReply(player,$"{entry.Name} | {entry.Tier} | {entry.Status}\n" + string.Join("\n",entry.Discussion.Skip(Math.Max(0,entry.Discussion.Count-6))));
                return;
            }
            string action = args[2].ToLowerInvariant();
            if (action == "test" && (panel || staff) && entry.Status == "Pending")
            {
                if (encounters.Any(r => r.SubmissionId == args[1])) { SendReply(player,"This revision already has an active playtest."); return; }
                if (string.IsNullOrEmpty(entry.PlaytestCode)) entry.PlaytestCode=Guid.NewGuid().ToString("N").Substring(0,12);
                Save();
                StartPreview(player,new[]{"spawn",entry.Snapshot},r => { r.Tier=entry.Tier; r.Practice=true; r.SubmissionId=args[1]; });
                return;
            }
            if (action=="credit" && owner && args.Length==4 && ulong.TryParse(args[3],out ulong contributor) && contributor!=entry.Builder)
            { entry.Collaborators.Add(contributor); Save(); SendReply(player,"Collaborator credited."); return; }
            if (action=="uncredit" && collaborator)
            { entry.Collaborators.Remove(player.userID); Save(); SendReply(player,"Your collaborator credit was removed."); return; }
            if (action=="anonymous" && owner && args.Length==4 && bool.TryParse(args[3],out bool anonymous))
            { entry.Anonymous=anonymous; Save(); SendReply(player,"Attribution updated."); return; }
            if (action == "feedback" && (panel || staff || owner))
            {
                SendReply(player,string.Join("\n",entry.Feedback.Select(x => $"{x.Key}: {x.Value}")));
                return;
            }
            if (action == "accept" && panel && entry.Status=="Pending" && args.Length==4 && ulong.TryParse(args[3],out ulong tester))
            {
                if (tester == player.userID || !entry.Feedback.ContainsKey(tester) || !entry.Accepted.Add(tester))
                { SendReply(player,"Feedback is absent, already accepted, or your own."); return; }
                int amount = rules.TryGetValue(entry.Tier,out var tier) ? Math.Max(0,tier.TestFeedbackRP) : 0;
                QueueCredit(tester,amount,"Feedback " + entry.Snapshot);
                entry.Discussion.Add($"Feedback by {tester} accepted by {player.displayName}.");
            }
            else if (action == "comment" && args.Length > 3)
                entry.Discussion.Add($"{player.displayName}: {string.Join(" ",args.Skip(3))}");
            else if (action == "publish" && owner && entry.Status == "Approved") PublishBase(entry);
            else if (panel && !owner && entry.Status == "Pending" && new[]{"approve","revise","reject"}.Contains(action))
            {
                entry.Votes[player.userID] = action;
                entry.Discussion.Add($"{player.displayName}: {action} {string.Join(" ",args.Skip(3))}");
                if (entry.Votes.Values.Count(v => v == action) >= Math.Max(1,Convert.ToInt32(Config["RequiredReviewVotes"] ?? 2)))
                {
                    entry.Status = action == "approve" ? "Approved" : action == "revise" ? "Revision requested" : "Rejected";
                    entry.ApprovedAt = Now;
                }
            }
            else { SendReply(player,"Available actions depend on role and status: comment, test, approve, revise, reject, publish."); return; }
            Audit(player,action,entry.Name + " " + entry.Status);
            Save();
            SendReply(player,$"{entry.Name}: {entry.Status}");

        }

        private void PublishBase(Submission entry)
        {
            var pool = ReadConfigSection<Dictionary<string,string>>("BasePool") ?? new Dictionary<string,string>();
            string previous = entry.ParentId;
            while (previous != null && state.Submissions.TryGetValue(previous,out var ancestor))
            {
                pool.Remove(ancestor.Snapshot);
                previous = ancestor.ParentId;
            }
            pool[entry.Snapshot] = entry.Tier;
            Config["BasePool"] = pool;
            SaveConfig();
            entry.Status = "Published";
            Save();
        }

        private void OnNewSave(string filename)
        {
            if (state == null) return;
            state.Cooldowns.Clear();
            Save();
        }

        private sealed class Saved
        {
            public Dictionary<string,CatalogItem> Catalog = new Dictionary<string,CatalogItem>();
            public Dictionary<ulong, double> Cooldowns = new Dictionary<ulong, double>();
            public List<string> Rotation = new List<string>();
            public Dictionary<string, Submission> Submissions = new Dictionary<string, Submission>();
            public Dictionary<ulong, PlayerStats> Stats = new Dictionary<ulong, PlayerStats>();
            public Dictionary<ulong,int> Completions = new Dictionary<ulong,int>();
            public List<Credit> Credits = new List<Credit>();
            public List<Notice> Queue = new List<Notice>();
        }

        private sealed class PlayerStats
        {
            public int Deaths, Failures;
            public long PaidRP;
        }

        private PlayerStats Stats(ulong id)
        {
            if (!state.Stats.TryGetValue(id,out var stats)) state.Stats[id] = stats = new PlayerStats();
            return stats;
        }

        private void OnPlayerDeath(BasePlayer player, HitInfo hit)
        {
            if (player == null || player.IsNpc) return;
            var raid = At(player.transform.position);
            if (raid == null || raid.IsSiege || raid.Event || raid.Practice || raid.Phase != "Active" || !raid.Members.Contains(player.userID)) return;
            Stats(player.userID).Deaths++;
            Save();
        }

        private sealed class Notice
        {
            public string id = Guid.NewGuid().ToString("N");
            public string message;
        }

        private Saved state;
        private bool sending;
        private static double Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        private void Save() => Interface.Oxide.DataFileSystem.WriteObject("RERaid_State", state);

        protected override void LoadDefaultConfig()
        {
            Config["Tiers"] = Tiers.ToDictionary(t => t, t => new TierRules { Minutes = t == "Bruh" ? 60 : 45, ExteriorScientists = Array.IndexOf(Tiers,t) });
            Config["LootTables"] = new Dictionary<string, List<LootEntry>> { {"starter", new List<LootEntry> { new LootEntry { Item="scrap", Min=10, Max=25 } } } };
            Config["Radius"] = 60;
            Config[RecoverySecondsKey] = DefaultRecoverySeconds;
            Config["EnableAutomaticRaids"] = false;
            Config["AutomaticRaidSlots"] = 1;
            Config["StandardCooldownSeconds"] = 3600;
            Config["EnableBuilderSubmissions"] = false;
            Config["RequiredReviewVotes"] = 2;
            Config["PublicScavengeMinutes"] = 15;
            Config["BasePool"] = new Dictionary<string,string>();
            Config["RaidCenterEndpoint"] = "";
            Config["RaidCenterToken"] = "";
        }

        private void Announce(string message)
        {
            PrintToChat(message);
            Puts(message);
            state.Queue.Add(new Notice { message = message });
            Save();
        }

        private void Publish()
        {
            string url = Config["RaidCenterEndpoint"] as string;
            string token = Config["RaidCenterToken"] as string;
            if (sending || state.Queue.Count == 0 || string.IsNullOrEmpty(url) || string.IsNullOrEmpty(token)) return;
            sending = true;
            Notice first = state.Queue[0];
            webrequest.Enqueue(url, JsonConvert.SerializeObject(first), (code, body) =>
            {
                sending = false;
                if (code < 200 || code >= 300) return;
                state.Queue.Remove(first);
                Save();
            }, this, Oxide.Core.Libraries.RequestMethod.POST,
                new Dictionary<string,string> { {"Authorization", "Bearer " + token}, {"Content-Type", "application/json"} });
        }

        private string Status(Preview raid)
        {
            if (raid == null || !raid.Playable || !raid.Finished) return "No standard raid is available.";
            double secondsLeft = Math.Max(0, raid.Deadline - Now);
            string timeLeft = secondsLeft <= 60 ? $"{Math.Ceiling(secondsLeft)} sec" : $"{Math.Ceiling(secondsLeft / 60)} min";
            string attribution = string.IsNullOrEmpty(raid.BuilderCredit) ? "" : $" by {raid.BuilderCredit}";
            return $"#{raid.Id} {raid.Name}{attribution} | {Grid(raid.Center)} | {raid.Phase} | {raid.Objectives.Count}/{raid.OriginalCount} objectives remaining | {timeLeft}";
        }

        private static string Grid(Vector3 pos)
        {
            int x = Mathf.Max(0,Mathf.FloorToInt((pos.x - TerrainMeta.Position.x) / 146.3f));
            int y = Mathf.Max(0,Mathf.FloorToInt((TerrainMeta.Position.z + TerrainMeta.Size.z - pos.z) / 146.3f));
            string col = "";
            do { col = (char)('A' + x % 26) + col; x = x / 26 - 1; } while (x >= 0);
            return col + y;
        }

        private void LockSubmittedRaid(Preview raid)
        {
            const string prefab = "assets/prefabs/locks/keypad/lock.code.prefab";
            var lockItem = new Item { info = ItemManager.FindItemDefinition("lock.code") };
            foreach (var entity in raid.Entities.ToArray())
            {
                if (entity == null || entity.IsDestroyed || !entity.HasSlot(BaseEntity.Slot.Lock)) continue;
                var slot = entity.GetSlot(BaseEntity.Slot.Lock);
                var codeLock = slot as CodeLock;
                if (codeLock == null)
                {
                    var spawnedLock = GameManager.server.CreateEntity(prefab, Vector3.zero);
                    codeLock = spawnedLock as CodeLock;
                    if (codeLock == null)
                    {
                        spawnedLock?.Kill();
                        PrintWarning($"Could not create a code lock for {entity.ShortPrefabName} in raid #{raid.Id}.");
                        continue;
                    }

                    codeLock.SetParent(entity, "lock");
                    codeLock.OnDeployed(entity, null, lockItem);
                    codeLock.enableSaving = false;
                    codeLock.Spawn();
                    if (slot != null && !slot.IsDestroyed) slot.Kill();
                    entity.SetSlot(BaseEntity.Slot.Lock, codeLock);
                    raid.Entities.Add(codeLock);
                }
                codeLock.code = UnityEngine.Random.Range(0, 10000).ToString("D4");
                codeLock.hasCode = true;
                codeLock.guestCode = string.Empty;
                codeLock.hasGuestCode = false;
                codeLock.whitelistPlayers.Clear();
                codeLock.guestPlayers.Clear();
                using (var flags = codeLock.StartSetFlags(BaseEntity.FlagsUpdateMode.SendNetworkUpdate))
                    flags.Set(BaseEntity.Flags.Locked, true);
            }
        }

        private static bool IsFurnace(StorageContainer container)
        {
            return container is BaseOven &&
                (container.ShortPrefabName == "furnace" || container.ShortPrefabName == "furnace.large" ||
                 container.ShortPrefabName == "electricfurnace.deployed" ||
                 container.ShortPrefabName == "industrial_electric_furnace.deployed");
        }

        private static bool IsLocker(StorageContainer container) => container.ShortPrefabName == "locker.deployed";

        private static bool IsSpecialRaidContainer(StorageContainer container) =>
            container is BuildingPrivlidge || IsFurnace(container) || IsLocker(container);

        private static void AddRaidItem(StorageContainer container, string shortName, int amount)
        {
            var item = ItemManager.CreateByName(shortName, amount);
            if (item != null && !item.MoveToContainer(container.inventory)) item.Remove();
        }

        private static void StockRaidContainer(StorageContainer container)
        {
            if (container is BuildingPrivlidge)
            {
                AddRaidItem(container, "wood", UnityEngine.Random.Range(100, 301));
                AddRaidItem(container, "metal.fragments", UnityEngine.Random.Range(25, 101));
                AddRaidItem(container, "scrap", UnityEngine.Random.Range(10, 31));
                AddRaidItem(container, "metal.refined", UnityEngine.Random.Range(2, 7));

                string[] optional = { "stones", "lowgradefuel", "crude.oil", "cloth", "leather" };
                foreach (string item in optional)
                    if (UnityEngine.Random.value < 0.5f)
                        AddRaidItem(container, item, UnityEngine.Random.Range(10, 41));
            }
            else if (IsLocker(container))
            {
                AddRaidItem(container, "hoodie", 1);
                AddRaidItem(container, "pants", 1);
                AddRaidItem(container, "shoes.boots", 1);
                if (UnityEngine.Random.value < 0.5f) AddRaidItem(container, "roadsign.jacket", 1);
            }
            else if (IsFurnace(container))
            {
                AddRaidItem(container, UnityEngine.Random.value < 0.5f ? "metal.ore" : "sulfur.ore",
                    UnityEngine.Random.Range(25, 101));
                if (!container.ShortPrefabName.Contains("electric"))
                    AddRaidItem(container, "wood", UnityEngine.Random.Range(50, 151));
            }
        }

        private static bool Objective(BaseEntity e)
        {
            return e is BuildingPrivlidge || e is BoxStorage || e is LootContainer;
        }

        private static readonly string[] Tiers = { "Easy", "Medium", "Hard", "Unfair", "Bruh" };

        private sealed class LootEntry
        {
            public string Item;
            public string Table;
            public int Weight = 1;
            public int Min = 1;
            public int Max = 1;
        }

        private sealed class TierRules
        {
            public int Minutes = 45;
            public int Rolls = 2;
            public int ExteriorScientists;
            public int RespawnSeconds = 120;
            public bool PowerTurrets = true;
            public int MinimumRP;
            public int MaximumRP;
            public int UnlockDay = 1;
            public int AutomaticSlots = 1;
            public List<LootEntry> Guaranteed = new List<LootEntry>();
            public int TestFeedbackRP;
            public string Table = "starter";
        }

        private Dictionary<string, TierRules> rules;
        private Dictionary<string, List<LootEntry>> tables;

        // Oxide loads nested JSON objects as untyped collections.
        private T ReadConfigSection<T>(string key) where T : class
        {
            object value = Config[key];
            if (value == null)
                return null;

            if (value is T typed)
                return typed;

            return JsonConvert.DeserializeObject<T>(JsonConvert.SerializeObject(value));
        }

        private void Loaded()
        {
            bool updated = false;
            foreach (var setting in new Dictionary<string,int> {
                { RecoverySecondsKey, DefaultRecoverySeconds }, { "AutomaticRaidSlots", 1 }, { "StandardCooldownSeconds", 3600 } })
            {
                if (Config[setting.Key] != null) continue;
                Config[setting.Key] = setting.Value;
                updated = true;
            }
            foreach (string key in new[]{"CatalogEndpoint","CatalogReadToken","CatalogPublishToken"})
                if (Config[key]==null) { Config[key]=""; updated=true; }
            if (updated) SaveConfig();

            rules = ReadConfigSection<Dictionary<string, TierRules>>("Tiers") ?? new Dictionary<string, TierRules>();
            tables = ReadConfigSection<Dictionary<string, List<LootEntry>>>("LootTables") ?? new Dictionary<string, List<LootEntry>>();
        }

        private TierRules Rules(Preview raid) => rules.TryGetValue(raid.Tier, out var found) ? found : new TierRules();

        private LootEntry Roll(string table, HashSet<string> visited)
        {
            if (string.IsNullOrEmpty(table) || !visited.Add(table) || !tables.TryGetValue(table, out var entries) || entries == null) return null;
            var options = entries.Where(e => e != null && e.Weight > 0).ToList();
            if (options.Count == 0) return null;
            double value = UnityEngine.Random.value * options.Sum(e => (double)e.Weight);
            var pick = options.Last();
            foreach (var entry in options) { value -= entry.Weight; if (value < 0) { pick = entry; break; } }
            return string.IsNullOrEmpty(pick.Table) ? pick : Roll(pick.Table, visited);
        }

        private IEnumerable<LootEntry> RollLoot(TierRules tier)
        {
            if (tier.Guaranteed != null)
                foreach (var entry in tier.Guaranteed)
                    yield return string.IsNullOrEmpty(entry?.Table) ? entry : Roll(entry.Table,new HashSet<string>());
            for (int roll = 0; roll < Mathf.Clamp(tier.Rolls,0,200); roll++)
                yield return Roll(tier.Table,new HashSet<string>());
        }

        private IEnumerable<LootEntry> RollCatalogLoot(WebLoot loot)
        {
            foreach (var entry in loot.Guaranteed) yield return entry;
            var entries = loot.Entries;
            if (entries.Count == 0) yield break;
            double total = entries.Sum(e => (double)e.Weight);
            for (int i = 0; i < Mathf.Clamp(loot.Rolls, 0, 200); i++)
            {
                double draw = UnityEngine.Random.value * total;
                yield return entries.FirstOrDefault(e => (draw -= e.Weight) < 0) ?? entries.Last();
            }
        }

        private void SimulateLoot(BasePlayer player,string[] args)
        {
            if (!CanManagePreviews(player) && !permission.UserHasPermission(player.UserIDString,"reraid.panel"))
            { SendReply(player,"Panel permission required."); return; }
            if (args.Length != 3 || !rules.TryGetValue(args[1],out var tier) || !int.TryParse(args[2],out int runs) || runs < 1 || runs > 100)
            { SendReply(player,"Use /reraid loot <tier> <1-100 rolls>."); return; }
            var totals = new Dictionary<string,long>();
            for (int run=0;run<runs;run++)
                foreach (var entry in RollLoot(tier))
                {
                    if (string.IsNullOrEmpty(entry?.Item)) continue;
                    int min=Mathf.Clamp(entry.Min,1,100000);
                    totals.TryGetValue(entry.Item,out long previous);
                    totals[entry.Item]=previous+UnityEngine.Random.Range(min,Mathf.Clamp(entry.Max,min,100000)+1);
                }
            SendReply(player,$"{runs} simulated {args[1]} raids. Total items: " + string.Join(", ",totals.OrderByDescending(x=>x.Value).Take(20).Select(x=>x.Key+" ×"+x.Value)));
        }

        private void Gamble(BasePlayer player, string[] args)
        {
            var r = ForPlayer(player);
            if (args.Length != 2)
            { SendReply(player, "Choose /reraid gamble solo, /reraid gamble team, or /reraid gamble clan."); return; }
            if (r == null || r.Practice || r.Phase != "Active" || !r.Members.Contains(player.userID))
            { SendReply(player, "Claim a standard raid before choosing an RP roll."); return; }
            if (r.Reward != "Undecided")
            { SendReply(player, $"Your reward is already set to {(r.Reward == "RP" ? "RP roll" : "Raid loot")}. Choose RP after claiming at the perimeter, before damaging the main base."); return; }
            if (ServerRewards == null || !ServerRewards.IsLoaded || Rules(r).MaximumRP < 1)
            { SendReply(player, "RP rewards are disabled for this raid. You can still finish for raid loot."); return; }
            var ids = new HashSet<ulong> { player.userID };
            switch (args[1].ToLowerInvariant())
            {
                case "solo": break;
                case "team":
                    if (player.Team == null) { SendReply(player, "Join a team to select team rewards."); return; }
                    ids.UnionWith(player.Team.members); break;
                case "clan":
                    var roster = Clans?.Call("GetClanMembers", player.userID) as List<string>;
                    if (roster == null || roster.Count == 0) { SendReply(player, "Clan membership required."); return; }
                    foreach (string id in roster) if (ulong.TryParse(id, out ulong member)) ids.Add(member);
                    break;
                default: SendReply(player, "Use /reraid gamble solo, team, or clan."); return;
            }
            ids.IntersectWith(r.Members);
            r.RewardMembers = ids.ToList();
            r.Reward = "RP";
            r.Members.IntersectWith(ids);
            foreach (var box in r.Entities.OfType<StorageContainer>())
                if (r.Objectives.Contains(box) || IsSpecialRaidContainer(box))
                    box.inventory?.Clear();
            RefreshHud();
            SendReply(player, "You chose an RP roll. Finish the raid to receive your roll.");
        }

        private sealed class Credit
        {
            public string Id = Guid.NewGuid().ToString("N");
            public ulong Player;
            public int Amount;
            public string Reason;
            public bool Attempted;
        }

        private void QueueCredit(ulong id,int amount,string reason)
        {
            if (amount > 0) state.Credits.Add(new Credit { Player=id,Amount=amount,Reason=reason });
        }

        private void DeliverCredits()
        {
            if (ServerRewards == null || !ServerRewards.IsLoaded) return;
            foreach (var credit in state.Credits.Where(c => !c.Attempted).Take(20).ToArray())
            {
                credit.Attempted=true;
                Save();
                var ok=ServerRewards.Call("AddPoints",credit.Player,credit.Amount);
                if (Equals(ok,true))
                {
                    Stats(credit.Player).PaidRP += credit.Amount;
                    state.Credits.Remove(credit);
                    Save();
                }
                LogToFile("settlement",JsonConvert.SerializeObject(new {credit,confirmed=Equals(ok,true)}),this,true);
            }
        }

        private void Pay(Preview r)
        {
            if (r.Reward != "RP" || r.RewardMembers.Count == 0) return;
            var tier = Rules(r);
            int maximum = Mathf.Clamp(tier.MaximumRP,0,100000000);
            int total = UnityEngine.Random.Range(Mathf.Clamp(tier.MinimumRP,0,maximum), maximum + 1);
            int share = total / r.RewardMembers.Count;
            foreach (ulong id in r.RewardMembers) QueueCredit(id,share,"Raid " + r.Name);
            Save();
        }

        private const string ScientistPrefab = "assets/rust.ai/agents/npcplayer/humannpc/scientist/scientistnpc_full_any.prefab";

        private void MaintainGuards(Preview raid)
        {
            TierRules tier = Rules(raid);
            if (raid.Phase != "Active" && raid.Phase != "Available") return;
            raid.Guards.RemoveWhere(g => g == null || g.IsDestroyed);
            foreach (var guard in raid.Guards)
            {
                if (Inside(raid,guard.transform.position)) continue;
                guard.Kill();
            }
            if (Time.realtimeSinceStartup < raid.NextGuardCheck) return;
            raid.NextGuardCheck = Time.realtimeSinceStartup + Math.Max(5, tier.RespawnSeconds);
            int missing = Mathf.Clamp(tier.ExteriorScientists, 0, 20) - raid.Guards.Count;
            for (int i = 0; i < missing; i++)
            {
                var angle = UnityEngine.Random.Range(0f, 360f);
                var point = raid.Center + Quaternion.Euler(0, angle, 0) * Vector3.forward * Radius * 0.7f;
                UnityEngine.AI.NavMeshHit nav;
                if (!UnityEngine.AI.NavMesh.SamplePosition(point, out nav, 8f, UnityEngine.AI.NavMesh.AllAreas)) continue;
                var guard = GameManager.server.CreateEntity(ScientistPrefab, nav.position) as ScientistNPC;
                if (guard == null) continue;
                guard.enableSaving = false;
                guard.Spawn();
                raid.Guards.Add(guard);
                raid.Entities.Add(guard);
            }
        }

        private void PrepareRaid(Preview raid)
        {
            var credited = state.Submissions.Values.FirstOrDefault(x => x.Snapshot == raid.Snapshot);
            if (credited != null)
            {
                raid.Name = credited.Name;
                raid.BuilderCredit = credited.Anonymous ? "Anonymous RE Builder" : credited.BuilderName;
            }
            else if (raid.Snapshot.StartsWith("re_catalog_",StringComparison.Ordinal))
            {
                var item=state.Catalog.Values.FirstOrDefault(x=>"re_catalog_"+x.id==raid.Snapshot);
                if (item!=null) { raid.Name=item.name; raid.CatalogLoot=item.loot; }
            }
            if (raid.IsSiege)
            {
                var cupboards = raid.Entities.OfType<BuildingPrivlidge>().Where(tc => tc != null && !tc.IsDestroyed).Distinct().ToList();
                if (cupboards.Count != 1) { PrintWarning("Siege requires exactly one original TC."); ClearPreview(raid); return; }
                raid.SiegeCupboard = cupboards[0];
                raid.SiegeCupboard.authorizedPlayers.Clear();
                foreach (ulong defender in raid.Defending) raid.SiegeCupboard.authorizedPlayers.Add(defender);
                raid.SiegeCupboard.SendNetworkUpdate();
                raid.Phase = "Preparation";
                raid.Deadline += Now;
                SpawnBoundary(raid);
                Announce($"{raid.Attackers} vs {raid.Defenders}: preparation started at {raid.Name}.");
                return;
            }
            foreach (var entity in raid.Entities)
                if (entity != null && !entity.IsDestroyed && Objective(entity)) raid.Objectives.Add(entity);
            if (raid.Objectives.Count == 0)
            {
                PrintWarning("No original loot objectives found. Removing paste.");
                ClearPreview(raid);
                return;
            }
            if (!raid.Event && (credited != null || raid.Snapshot.StartsWith("re_review_", StringComparison.Ordinal) ||
                raid.Snapshot.StartsWith("re_catalog_", StringComparison.Ordinal)))
                LockSubmittedRaid(raid);
            raid.OriginalCount = raid.Objectives.Count;
            raid.Phase = "Available";
            raid.Deadline = Now + 2700;
            var tier = Rules(raid);
            if (tier.PowerTurrets && !raid.Event)
                foreach (var turret in raid.Entities.OfType<AutoTurret>()) turret.InitiateStartup();
            var boxes = raid.Objectives.OfType<StorageContainer>().Where(x => x.inventory != null &&
                (raid.Event || !IsSpecialRaidContainer(x))).ToList();
            if (!raid.Event)
                foreach (var container in raid.Entities.OfType<StorageContainer>())
                    if (!container.IsDestroyed && container.inventory != null && IsSpecialRaidContainer(container))
                        StockRaidContainer(container);
            foreach (var entry in raid.CatalogLoot == null ? RollLoot(tier) : RollCatalogLoot(raid.CatalogLoot))
            {
                if (boxes.Count == 0) break;
                if (string.IsNullOrEmpty(entry?.Item)) continue;
                int min = Mathf.Clamp(entry.Min, 1, 100000);
                var item = ItemManager.CreateByName(entry.Item, UnityEngine.Random.Range(min, Mathf.Clamp(entry.Max, min, 100000) + 1));
                if (item != null && !item.MoveToContainer(boxes[UnityEngine.Random.Range(0, boxes.Count)].inventory)) item.Remove();
            }
            if (raid.Event)
            {
                raid.Phase = "Event preparation";
                raid.Deadline = Now + 3600;
                Announce($"Event {raid.EventId} preparation started. /siege register grub {raid.EventId}");
            }
            if (raid.Tier != "Easy")
            {
                float outer = raid.Entities.Where(e => e != null && !e.IsDestroyed).Select(e =>
                    Vector2.Distance(new Vector2(e.transform.position.x, e.transform.position.z), new Vector2(raid.Center.x, raid.Center.z))).DefaultIfEmpty(5f).Max() + 6f;
                if (outer + 3f >= Radius) { PrintWarning("Base exceeds configured raid radius."); ClearPreview(raid); return; }
                int segments = Mathf.CeilToInt(2 * Mathf.PI * outer / 5.8f);
                for (int i = 0; i < segments; i++)
                {
                    var rot = Quaternion.Euler(0, i * 360f / segments, 0);
                    var pos = raid.Center + rot * Vector3.forward * outer;
                    pos.y = TerrainMeta.HeightMap.GetHeight(pos);
                    var wall = GameManager.server.CreateEntity("assets/prefabs/building/wall.external.high.stone/wall.external.high.stone.prefab", pos, rot);
                    if (wall == null) { PrintWarning("Compound wall spawn failed."); ClearPreview(raid); return; }
                    wall.enableSaving = false; raid.Entities.Add(wall); raid.Walls.Add(wall); wall.Spawn();
                }
            }
            SpawnBoundary(raid);
            var marker = GameManager.server.CreateEntity("assets/prefabs/tools/map/genericradiusmarker.prefab", raid.Center) as MapMarkerGenericRadius;
            if (marker != null)
            {
                marker.enableSaving = false; marker.radius = 0.25f; marker.alpha = 0.65f;
                marker.color1 = new[] { Color.green, Color.blue, new Color(1,.5f,0), Color.red, Color.magenta }[Array.IndexOf(Tiers, raid.Tier)];
                marker.color2 = Color.black; raid.Entities.Add(marker); marker.Spawn(); marker.SendUpdate();
            }
            var pin = GameManager.server.CreateEntity(RaidPinPrefab, raid.Center) as VendingMachineMapMarker;
            if (pin != null)
            {
                pin.enableSaving = false;
                raid.Pin = pin;
                pin.markerShopName = $"{raid.Tier} Raid - {raid.Name}";
                raid.Entities.Add(pin);
                pin.Spawn();
                pin.SendNetworkUpdate();
            }
            else
            {
                PrintWarning($"Unable to create a map pin for {raid.Name}.");
            }

            if (raid.Practice && raid.Snapshot.StartsWith("re_review_", StringComparison.Ordinal))
                CatalogRequest("/test/" + raid.SubmissionId + "/started", "{}", true, (code, body) =>
                {
                    if (code != 200) PrintWarning($"Raid Center could not record playtest start (HTTP {code}).");
                });
            if (raid.Automatic) { state.Rotation.Remove(raid.Snapshot); state.Rotation.Add(raid.Snapshot); }
            if (raid.Practice && state.Submissions.TryGetValue(raid.SubmissionId,out var test))
            {
                Puts($"Playtest at {Grid(raid.Center)}: /reraid playtest {test.PlaytestCode}");
                foreach (var member in BasePlayer.activePlayerList)
                    if (CanManagePreviews(member) || permission.UserHasPermission(member.UserIDString,"reraid.panel"))
                        SendReply(member,$"Playtest code: {test.PlaytestCode}");
                return;
            }
            Announce($"{raid.Tier} raid available: {raid.Name} at {Grid(raid.Center)}.");
        }

        private void SpawnBoundary(Preview raid)
        {
            raid.Dome = SpawnBoundaryVisual(raid, GrayDomePrefab);
            if (raid.Tier == "Bruh")
                raid.BoundaryRing = SpawnBoundaryVisual(raid, PurpleDomePrefab);
            else if (raid.Phase == "Available")
                raid.BoundaryRing = SpawnBoundaryVisual(raid, GreenDomePrefab);
        }

        private SphereEntity SpawnBoundaryVisual(Preview raid, string prefab)
        {
            var entity = GameManager.server.CreateEntity(prefab, raid.Center);
            var sphere = entity as SphereEntity;
            if (sphere == null)
            {
                entity?.Kill();
                PrintWarning($"Unable to create raid boundary visual '{prefab}' for {raid.Name}.");
                return null;
            }

            // Rust's visualization sphere uses the full diameter for its scale.
            sphere.currentRadius = Radius * 2f;
            sphere.lerpRadius = sphere.currentRadius;
            sphere.enableSaving = false;
            raid.Entities.Add(sphere);
            sphere.Spawn();
            return sphere;
        }

        private void RemoveBoundaryVisual(Preview raid, SphereEntity sphere)
        {
            if (sphere == null || sphere.IsDestroyed)
                return;

            raid.Entities.Remove(sphere);
            sphere.Kill();
        }

        private bool Cooling(ulong id) => state.Cooldowns.TryGetValue(id, out double until) && until > Now;
        private float Radius => Math.Max(10, Convert.ToSingle(Config["Radius"] ?? 60));
        private bool Inside(Preview raid, Vector3 position) => Vector3.Distance(position, raid.Center) <= Radius;

        private object OnEntityTakeDamage(BaseCombatEntity entity, HitInfo hit)
        {
            var raid = encounters.FirstOrDefault(r => r.Entities.Contains(entity)) ?? At(entity.transform.position);
            if (raid == null || !raid.Playable) return null;
            if (raid.Event && raid.Phase == "Event preparation" && hit?.InitiatorPlayer != null && raid.PlayerBuilt.Contains(entity) && !raid.Registered.Contains(hit.InitiatorPlayer.userID)) return true;
            if (!raid.Event && !raid.IsSiege && entity is BasePlayer raider && !raider.IsNpc)
            {
                var sourcePlayer=hit?.InitiatorPlayer;
                if (sourcePlayer!=null && !sourcePlayer.IsNpc && sourcePlayer!=raider &&
                    (!Inside(raid,sourcePlayer.transform.position) || raid.Phase!="Available" &&
                    (!raid.Members.Contains(sourcePlayer.userID) || !raid.Members.Contains(raider.userID)))) return true;
            }
            if (raid.IsSiege && entity is BasePlayer victim && !victim.IsNpc && Inside(raid,victim.transform.position))
            {
                var source = hit?.InitiatorPlayer;
                if (source != null && (raid.Phase != "Combat" || !raid.Members.Contains(victim.userID) || !raid.Members.Contains(source.userID) || !Inside(raid,source.transform.position))) return true;
            }
            if (raid.Event && raid.Finished && Inside(raid,entity.transform.position))
            {
                var attacker = hit?.InitiatorPlayer;
                if (raid.Phase == "Public scavenging") return null;
                if (attacker != null && (!Inside(raid,attacker.transform.position) || !raid.Registered.Contains(attacker.userID))) return true;
                if (raid.Phase == "Event preparation" && raid.Entities.Contains(entity)) return true;
                if (raid.Phase == "Guns only" && hit != null && hit.damageTypes.Get(Rust.DamageType.Explosion) > 0) return true;
                if ((raid.Phase == "Ceasefire" || raid.Phase == "Exclusive loot") && attacker != null) return true;
                return null;
            }
            var player = hit?.InitiatorPlayer ?? (hit?.Initiator?.creatorEntity as BasePlayer);
            if (!raid.Entities.Contains(entity))
            {
                if (entity is BuildingBlock || entity is Door) ClaimHint(player,raid,"Hit a wall or door that belongs to the raid base.");
                return null;
            }
            if (!raid.Finished) return true;
            if (raid.IsSiege && entity == raid.SiegeCupboard && (player == null || !raid.Attacking.Contains(player.userID))) return true;
            if (raid.IsSiege)
                return raid.Phase == "Combat" && player != null && raid.Members.Contains(player.userID) && Inside(raid,player.transform.position) ? (object)null : true;
            if (player == null) return true;
            if (!Inside(raid,player.transform.position)) { ClaimHint(player,raid,"Step inside the dome to claim."); return true; }
            if (!raid.Practice && Cooling(player.userID)) { ClaimHint(player,raid,"Wait for the cooldown shown in /reraid before claiming another raid."); return true; }
            if (raid.Practice && !raid.Members.Contains(player.userID) && !CanManagePreviews(player) && !permission.UserHasPermission(player.UserIDString,"reraid.panel"))
            { ClaimHint(player,raid,"Join this playtest before claiming."); return true; }
            if (raid.Guards.Contains(entity)) return raid.Phase == "Available" || raid.Members.Contains(player.userID) ? (object)null : true;
            if (raid.Phase == "Available")
            {
                if (!raid.Walls.Contains(entity) && !(entity is BuildingBlock) && !(entity is Door) && !raid.Objectives.Contains(entity)) { ClaimHint(player,raid,"Damage an original raid wall, door, or loot objective to claim the raid."); return null; }
                var members = new HashSet<ulong> { player.userID };
                if (player.Team != null) members.UnionWith(player.Team.members);
                var clan = Clans?.Call("GetClanMembers", player.userID) as List<string>;
                if (clan != null) foreach (string id in clan) if (ulong.TryParse(id, out ulong member)) members.Add(member);
                if (!raid.Practice)
                {
                    ulong coolingMember = members.FirstOrDefault(Cooling);
                    if (coolingMember != 0)
                    {
                        string who = CanManagePreviews(player) ? $" ({coolingMember})" : "";
                        ClaimHint(player,raid,$"A team or clan member{who} has an active cooldown.");
                        return true;
                    }
                    var busy = encounters.FirstOrDefault(other => other != raid && !other.Practice && !other.Event && !other.IsSiege && other.CooldownMembers.Overlaps(members));
                    if (busy != null) { ClaimHint(player,raid,$"Your group already holds raid #{busy.Id} ({busy.Phase})."); return true; }
                }
                if (raid.Practice) raid.Members.Add(player.userID); else raid.Members.UnionWith(members);
                raid.CooldownMembers.UnionWith(members);
                if (raid.Walls.Contains(entity)) raid.Reward = "Undecided";
                raid.Phase = "Active";
                lastClaimHit[player.userID]=$"Claimed raid #{raid.Id}.";
                if (raid.Tier != "Bruh")
                {
                    RemoveBoundaryVisual(raid, raid.BoundaryRing);
                    raid.BoundaryRing = null;
                }
                raid.Deadline = Now + 60 * Mathf.Clamp(Rules(raid).Minutes, 1, raid.Tier == "Bruh" ? 60 : 1440);
                Announce($"{player.displayName} claimed {raid.Name}.");
                RefreshHud();
            }
            if (!raid.Members.Contains(player.userID)) return true;
            if (raid.Reward == "Undecided" && !raid.Walls.Contains(entity))
            {
                raid.Reward = "Physical";
                RefreshHud();
            }
            return null;
        }

        private object CanLootEntity(BasePlayer player, DroppedItemContainer entity)
        {
            return MayLootAt(player,entity.transform.position);
        }

        private object CanLootEntity(BasePlayer player, LootableCorpse entity)
        {
            return MayLootAt(player,entity.transform.position);
        }

        private object OnItemPickup(Item item, BasePlayer player)
        {
            var drop=item?.GetWorldEntity();
            return drop == null ? null : MayLootAt(player,drop.transform.position);
        }

        private object MayLootAt(BasePlayer player,Vector3 position)
        {
            var raid=At(position);
            if (raid==null || !raid.Playable || !raid.Finished || raid.Phase=="Public scavenging") return null;
            if (!Inside(raid,player.transform.position)) return false;
            if (raid.Event) return raid.Registered.Contains(player.userID) ? (object)null : false;
            if (raid.Phase=="Available") return raid.Practice || !Cooling(player.userID) ? (object)null : false;
            return raid.Members.Contains(player.userID) ? (object)null : false;
        }

        private object CanLootEntity(BasePlayer player, StorageContainer entity)
        {
            var denied=MayLootAt(player,entity.transform.position);
            if (denied!=null) return denied;
            var raid = At(entity.transform.position);
            if (raid != null && raid.Event && Inside(raid,entity.transform.position))
                return raid.Phase == "Public scavenging" || (raid.Registered.Contains(player.userID) && raid.Phase != "Event preparation") ? (object)null : false;
            if (raid != null && raid.Playable && raid.Objectives.Contains(entity)) return false;
            if (raid != null && raid.Playable && Inside(raid,entity.transform.position) && raid.Phase != "Available" &&
                !raid.Members.Contains(player.userID)) return false;
            return null;
        }

        private void OnEntityKill(BaseNetworkable entity)
        {
            var raid = encounters.FirstOrDefault(r => ReferenceEquals(entity,r.SiegeCupboard) || (entity is BaseEntity obj && r.Objectives.Contains(obj)));
            if (raid != null && raid.IsSiege && raid.Phase == "Combat" && ReferenceEquals(entity, raid.SiegeCupboard))
            { SiegeVictory(raid, raid.Attacking); return; }
            if (raid == null || !(entity is BaseEntity original) || !raid.Objectives.Remove(original)) return;
            if (raid.Event || raid.Objectives.Count != 0) return;
            if (raid.Phase != "Active") { NextTick(() => { if (encounters.Contains(raid)) EndRaid(raid,"invalidated"); }); return; }
            raid.Phase = "Recovery";
            if (!raid.Practice) foreach (ulong id in raid.Members) state.Completions[id] = (state.Completions.TryGetValue(id, out int total) ? total : 0) + 1;
            Pay(raid);
            foreach (var guard in raid.Guards.ToArray()) if (guard != null && !guard.IsDestroyed) guard.Kill();
            raid.Guards.Clear();
            int recoverySeconds = int.TryParse(Convert.ToString(Config[RecoverySecondsKey]), out int configuredSeconds) && configuredSeconds > 0
                ? configuredSeconds : DefaultRecoverySeconds;
            raid.Deadline = Now + recoverySeconds;
            Announce($"{raid.Name} completed. Exclusive recovery lasts {recoverySeconds} seconds.");
        }

        private void OnEntityBuilt(Planner planner, GameObject gameObject)
        {
            var placed = gameObject == null ? null : gameObject.ToBaseEntity();
            var r = placed == null ? null : At(placed.transform.position);
            if (r == null || !r.Playable || !r.Finished) return;
            r.PlayerBuilt.Add(placed);
            placed.enableSaving = false;
        }

        private void EjectPlayer(BasePlayer player, Vector3 center, float distance)
        {
            Vector3 direction = player.transform.position - center;
            direction.y = 0f;
            direction = direction.sqrMagnitude < 0.01f ? Vector3.forward : direction.normalized;
            int solid = LayerMask.GetMask("Terrain", "World", "Construction", "Deployed", "Default");

            foreach (float angle in EjectionAngles)
            {
                Vector3 landing = center + Quaternion.Euler(0f, angle, 0f) * direction * distance;
                float surface = Math.Max(TerrainMeta.HeightMap.GetHeight(landing), TerrainMeta.WaterMap.GetHeight(landing));
                landing.y = surface + 32f;
                if (Physics.Raycast(landing, Vector3.down, out RaycastHit hit, 32f, solid, QueryTriggerInteraction.Ignore))
                    surface = Math.Max(surface, hit.point.y);

                landing.y = surface + EjectionClearance;
                if (Physics.CheckCapsule(landing + Vector3.up * 0.4f, landing + Vector3.up * 1.5f, 0.4f, solid, QueryTriggerInteraction.Ignore))
                    continue;

                player.Teleport(landing);
                return;
            }

        }

        private void Tick()
        {
            foreach (var raid in encounters.ToArray()) TickEncounter(raid);
        }

        private void TickEncounter(Preview raid)
        {
            if (raid.Pin != null && !raid.Pin.IsDestroyed)
            {
                string label=$"{raid.Tier} Raid - {raid.Name} | {raid.Phase} | {Math.Max(0, Math.Ceiling((raid.Deadline-Now)/60))} min";
                if (label!=raid.PinText) { raid.PinText=label; raid.Pin.markerShopName=label; raid.Pin.SendNetworkUpdate(); }
            }
            if (raid == null || !raid.Playable || !raid.Finished) return;
            if (!raid.Event && !raid.IsSiege) MaintainGuards(raid);
            if (raid.Event && Now >= raid.Deadline)
            {
                switch (raid.Phase)
                {
                    case "Event preparation": raid.Phase = "Event combat"; raid.Deadline = Now + raid.CombatMinutes * 60; break;
                    case "Event combat": raid.Phase = "Guns only"; raid.Deadline = Now + 600; break;
                    case "Guns only": raid.Phase = "Ceasefire"; raid.Deadline = Now + 300; break;
                    case "Ceasefire": raid.Phase = "Exclusive loot"; raid.Deadline = Now + 600; break;
                    case "Exclusive loot":
                        raid.Phase = "Public scavenging";
                        raid.Deadline = Now + 60 * Math.Max(1, Convert.ToInt32(Config["PublicScavengeMinutes"] ?? 15));
                        RemoveBoundaryVisual(raid, raid.Dome);
                        RemoveBoundaryVisual(raid, raid.BoundaryRing);
                        raid.Dome = null;
                        raid.BoundaryRing = null;
                        break;
                    default: EndRaid(raid,"event cleanup"); return;
                }
                Announce($"Event {raid.EventId}: {raid.Phase}.");
            }
            if (raid.IsSiege && Now >= raid.Deadline && raid.Phase == "Preparation")
            { raid.Phase = "Combat"; raid.Deadline = Now + 60 * raid.CombatMinutes; Announce($"Siege combat started at {raid.Name}."); }
            if (raid.IsSiege && Now >= raid.Deadline && raid.Phase == "Combat") SiegeVictory(raid, raid.Defending);
            if (Now >= raid.Deadline) { EndRaid(raid,raid.Phase == "Recovery" ? "recovered" : "expired"); return; }
            foreach (var player in BasePlayer.activePlayerList)
            {
                if (raid.Event && raid.Phase == "Event preparation" && raid.Registered.Contains(player.userID))
                {
                    float inner = Radius * 0.55f;
                    Vector3 offset = player.transform.position - raid.Center;
                    offset.y = 0f;
                    if (offset.sqrMagnitude < inner * inner)
                        EjectPlayer(player, raid.Center, inner + 2f);
                    continue;
                }
                if (raid.Event && (raid.Phase == "Public scavenging" || raid.Registered.Contains(player.userID))) continue;
                if (raid.IsSiege && raid.Members.Contains(player.userID))
                {
                    if (raid.Phase == "Combat" && !player.IsDead())
                    {
                        if (Inside(raid,player.transform.position)) raid.LastInside[player.userID] = player.transform.position;
                        else if (raid.LastInside.TryGetValue(player.userID, out Vector3 last)) player.Teleport(last);
                    }
                    continue;
                }
                if (!Inside(raid,player.transform.position) || (!raid.IsSiege && (raid.Practice || !Cooling(player.userID)) && (raid.Phase == "Available" || raid.Members.Contains(player.userID)))) continue;
                EjectPlayer(player, raid.Center, Radius + 4f);
            }
        }

        private void EndRaid(Preview raid,string reason)
        {
            if (!raid.Practice && raid.Phase == "Active" && (reason == "expired" || reason == "surrendered"))
                foreach (ulong member in raid.Members) Stats(member).Failures++;
            if (!raid.IsSiege && !raid.Practice) foreach (ulong id in raid.CooldownMembers) state.Cooldowns[id] = Now + Math.Max(0,Convert.ToInt32(Config["StandardCooldownSeconds"] ?? 3600));
            Announce($"{raid.Name} ended: {reason}.");
            ClearPreview(raid);
            foreach (var player in BasePlayer.activePlayerList)
                if (openRaidPanels.TryGetValue(player.userID, out var panel))
                    ShowRaidPanel(player, panel.Page);
        }

        private void Unload()
        {
            foreach (var player in BasePlayer.activePlayerList) { CuiHelper.DestroyUi(player, Panel); CuiHelper.DestroyUi(player,Hud); }
            foreach (ulong listenerId in bruhSpeakers.Keys.ToArray()) RemoveBruhSpeaker(listenerId);
            foreach (var raid in encounters.ToArray()) ClearPreview(raid);
        }
    }
}
