import {
  ActivityType,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type RepliableInteraction,
  type TextBasedChannel,
  type UserSelectMenuInteraction,
  type VoiceChannel,
} from "discord.js";
import { api, apiData, apiMessage, apiStatus, logBotError, type VoiceRoom } from "./api";
import { commands } from "./commands";
import { LegacyBot } from "../host";
import { checkRateLimit } from "./limits";
import { buildMessage } from "./messages";
import { addPlace, historyEmbed, notePanel, onChannelDeleted, stopUsing, syncPlaces, type RoomEvent } from "./places";
import { applyProtection, onAutoModeration, onMessageFlood, syncProtection } from "./protect";
import { onSessionVoiceState, syncAllSessions, syncSessions, voiceHistoryEmbed, type VoiceSession } from "./sessions";
import {
  createHubChannel,
  createRoomChannel,
  currentSettings,
  deleteRoom,
  canSee,
  grantAccess,
  isRoomChannel,
  lockedRooms,
  roomCategory,
  onChannelDelete,
  onVoiceState,
  rememberRoom,
  removeUnallowed,
  revokeAccess,
  roomByChannel,
  roomsOwnedBy,
  setLocked,
  startEmptyWatch,
  syncRooms,
} from "./rooms";
import {
  confirmDeleteRow,
  createModal,
  editModal,
  lockedRoomPicker,
  errorEmbed,
  linkRow,
  managePanel,
  newPasswordModal,
  okEmbed,
  passwordModal,
  retryRow,
  purgeRow,
  roomPanel,
} from "./ui";

// GuildMessages without MessageContent: the bot sees who sends messages and when (for floods),
// never what they say. AutoModerationExecution: what AutoMod stopped, for the site's log.
// The connection, the login, the slash commands and the presence belong to the host now.
export const voiceBot = new LegacyBot("voice");
const client = voiceBot.client;

const ephemeral = MessageFlags.Ephemeral as const;

// Tries left after a wrong password, per member and room, to say so in the next password form.
const triesLeft = new Map<string, number>();

// Each member has one private message from this bot at a time: a new one deletes the previous
// (Discord lets the bot do that for 15 minutes), so replies do not pile up in the channel.
const windows = new Map<string, { interaction: RepliableInteraction; at: number }>();
const WINDOW_TTL_MS = 14 * 60 * 1000;

async function newWindow(interaction: RepliableInteraction) {
  const previous = windows.get(interaction.user.id);
  windows.set(interaction.user.id, { interaction, at: Date.now() });
  if (previous && previous.interaction !== interaction && Date.now() - previous.at < WINDOW_TTL_MS) {
    await previous.interaction.deleteReply().catch(() => undefined);
  }
}

/**
 * Discord never removes a private message by itself (it stays until the member closes it), so a
 * one-off answer is deleted after a while. The bot can only do this for 15 minutes after the reply.
 */
function expireLater(interaction: RepliableInteraction, ms: number) {
  setTimeout(() => void interaction.deleteReply().catch(() => undefined), ms).unref();
}

setInterval(() => {
  const cutoff = Date.now() - WINDOW_TTL_MS;
  for (const [key, value] of windows) if (value.at < cutoff) windows.delete(key);
}, 60000).unref();

client.once(Events.ClientReady, async (ready) => {
  console.log(`[READY] Voice rooms ready (${ready.user.tag})`);
  await syncRooms(client);
  setInterval(() => void syncRooms(client), 30000).unref();
  // Often, so the log channel keeps up and messages changed on the web page update quickly.
  await syncPlaces(client);
  await syncAllSessions(client);
  await syncProtection(client);
  setInterval(() => void syncProtection(client), 15000).unref();
  setInterval(() => void syncPlaces(client), 5000).unref();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  onVoiceState(oldState, newState).catch((error) => logBotError("voice state", error));
  onSessionVoiceState(oldState, newState);
});

// Added to another server: its commands, and who is in voice there.
client.on(Events.GuildCreate, (guild) => {
  void syncSessions(guild).catch((error) => logBotError("sync sessions", error));
  void applyProtection(guild).catch((error) => logBotError("apply protection", error));
});

client.on(Events.ChannelDelete, (channel) => {
  if (channel.isDMBased()) return;
  // The bot's own voice rooms come and go; any other channel deleted is put back (protect.ts).
  const temporary = isRoomChannel(channel.id);
  if (channel.type === ChannelType.GuildVoice) void onChannelDelete(channel.id);
  if (!temporary) onChannelDeleted(channel).catch((error) => logBotError("protect channel", error));
});

client.on(Events.MessageCreate, (message) => {
  onMessageFlood(message).catch((error) => logBotError("flood", error));
});

client.on(Events.AutoModerationActionExecution, (execution) => {
  onAutoModeration(execution);
});

function voiceChannel(interaction: RepliableInteraction, channelId: string) {
  const channel = interaction.guild?.channels.cache.get(channelId);
  return channel?.type === ChannelType.GuildVoice ? (channel as VoiceChannel) : undefined;
}

function roomChannel(interaction: RepliableInteraction, roomId: number) {
  const channel = interaction.guild?.channels.cache.find((item) => roomByChannel(item.id)?.id === roomId);
  return channel?.type === ChannelType.GuildVoice ? (channel as VoiceChannel) : undefined;
}

function roomIdFrom(customId: string) {
  const id = Number(customId.split(":")[2]);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

async function loadRoom(interaction: RepliableInteraction, roomId: number) {
  const res = await api(interaction.user).get<{ room: VoiceRoom; access: string[] }>(`/api/internal/bot/voice/rooms/${roomId}`);
  return res.data;
}

async function fail(interaction: RepliableInteraction, title: string, text: string) {
  const payload = { embeds: [errorEmbed(title, text)], components: [] };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else {
    await interaction.reply({ ...payload, flags: ephemeral });
    await newWindow(interaction);
  }
  expireLater(interaction, 45000);
}

// Create

async function createRoom(interaction: ModalSubmitInteraction) {
  const guild = interaction.guild;
  if (!guild) return;
  await interaction.deferReply({ flags: ephemeral });
  await newWindow(interaction);
  const name = interaction.fields.getTextInputValue("name").trim();
  const password = interaction.fields.getTextInputValue("password");
  const limitText = interaction.fields.getTextInputValue("limit").trim();
  const userLimit = limitText ? Number(limitText) : 0;
  if (!Number.isInteger(userLimit) || userLimit < 0 || userLimit > 99) {
    await fail(interaction, "จำนวนคนไม่ถูก", "ใส่เลข 1–99 หรือเว้นว่างไว้ก็ได้");
    return;
  }
  let roomId: number;
  let roomName: string;
  try {
    const res = await api(interaction.user).post("/api/internal/bot/voice/rooms", {
      guildId: guild.id, guildName: guild.name, name, password, userLimit, ownerUsername: interaction.user.username,
    });
    roomId = res.data.id;
    roomName = res.data.name;
  } catch (error) {
    logBotError("create room", error);
    await fail(interaction, "สร้างห้องไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"));
    return;
  }
  let channel: VoiceChannel;
  try {
    const owner = interaction.member as GuildMember;
    channel = await createRoomChannel(guild, owner, roomName, userLimit);
    await api(interaction.user).put(`/api/internal/bot/voice/rooms/${roomId}/channel`, { channelId: channel.id });
  } catch (error) {
    logBotError("create channel", error);
    await api().delete(`/api/internal/bot/voice/rooms/${roomId}?reason=missing`).catch(() => undefined);
    await fail(interaction, "สร้างห้องไม่ได้", "บอทยังไม่มีสิทธิ์สร้างห้อง ลองบอกแอดมินดูนะ");
    return;
  }
  rememberRoom(channel.id, { id: roomId, ownerId: interaction.user.id, name: roomName, locked: true, hasPassword: true, kind: "command" });
  startEmptyWatch(channel);
  await channel.send(roomPanel(roomId, roomName, interaction.user.id)).catch(() => undefined);
  // The reply is the owner's panel for the new room, with a link to go in.
  await panelResult(interaction, roomId, {
    tone: "ok",
    title: "ได้ห้องแล้ว",
    text: `${channel} ล็อกไว้แล้ว ส่งรหัสให้เพื่อนได้เลย\nถ้าไม่มีใครอยู่ ${currentSettings().emptyDeleteMinutes} นาที ห้องจะหายไปเอง`,
  }, undefined, [linkRow(guild.id, channel.id, "เข้าห้อง")]);
}

// Join

async function askPassword(interaction: ButtonInteraction | ChatInputCommandInteraction | StringSelectMenuInteraction, channelId: string) {
  const room = roomByChannel(channelId);
  if (!room) {
    await fail(interaction, "ใช้กับห้องนี้ไม่ได้", "ห้องนี้ไม่ได้สร้างจากบอทห้องเสียง");
    return;
  }
  // A room in a private category is only for people who can see that category.
  const channel = voiceChannel(interaction, channelId);
  if (!channel || !canSee(channel, interaction.member as GuildMember)) {
    await fail(interaction, "ไม่เจอห้องนี้", "ห้องอาจถูกลบไปแล้ว");
    return;
  }
  if (room.ownerId === interaction.user.id) {
    await interaction.reply({ flags: ephemeral, content: "ห้องของคุณเอง เข้าได้เลย", components: [linkRow(interaction.guildId!, channelId)] });
    await newWindow(interaction);
    expireLater(interaction, 60000);
    return;
  }
  if (!room.locked) {
    await interaction.reply({ flags: ephemeral, content: "ห้องนี้ไม่ได้ล็อก เข้าไปได้เลย", components: [linkRow(interaction.guildId!, channelId)] });
    await newWindow(interaction);
    expireLater(interaction, 60000);
    return;
  }
  if (!room.hasPassword) {
    await fail(interaction, "ยังเข้าไม่ได้", "เจ้าของยังไม่ได้ตั้งรหัส ตอนนี้มีแค่เจ้าของที่เข้าได้");
    return;
  }
  const left = triesLeft.get(`${interaction.user.id}:${room.id}`);
  await interaction.showModal(passwordModal(room.id, room.name, left !== undefined ? `รหัสเมื่อกี้ไม่ถูก ลองได้อีก ${left} ครั้ง` : undefined));
}

async function checkPassword(interaction: ModalSubmitInteraction, roomId: number) {
  // Picked from the private list: show the result in place of the list.
  const fromPicker = interaction.isFromMessage() && interaction.message.flags.has(MessageFlags.Ephemeral);
  if (fromPicker) await interaction.deferUpdate();
  else {
    await interaction.deferReply({ flags: ephemeral });
    await newWindow(interaction);
  }
  // A wrong password keeps the list under the message, so trying again needs no new click.
  // A wrong password offers to try again at once; from the list, the list stays under it too.
  const failHere = async (title: string, text: string, retry = false) => {
    const list = fromPicker && interaction.guild ? lockedRooms(interaction.guild, interaction.member as GuildMember) : [];
    const rows = [...(retry ? [retryRow(roomId)] : []), ...(list.length ? lockedRoomPicker(list).components : [])];
    if (rows.length) await interaction.editReply({ content: "", embeds: [errorEmbed(title, text)], components: rows });
    else await fail(interaction, title, text);
  };
  const triesKey = `${interaction.user.id}:${roomId}`;
  const password = interaction.fields.getTextInputValue("password");
  try {
    await api(interaction.user).post(`/api/internal/bot/voice/rooms/${roomId}/unlock`, { password });
  } catch (error) {
    const status = apiStatus(error);
    if (status === 429 && apiData(error).lockedNow) {
      const channel = roomChannel(interaction, roomId);
      if (channel) {
        await channel.send(`${interaction.user} ใส่รหัสผิดครบ ${currentSettings().maxFailures} ครั้งแล้ว รออีก ${currentSettings().lockoutMinutes} นาทีค่อยลองใหม่`).catch(() => undefined);
      }
    }
    const remaining = Number(apiData(error).remaining);
    if (status === 403 && Number.isFinite(remaining)) triesLeft.set(triesKey, remaining);
    else triesLeft.delete(triesKey);
    await failHere(status === 403 ? "รหัสไม่ถูก" : "เข้าห้องไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"), status === 403);
    return;
  }
  triesLeft.delete(triesKey);
  // The password was right. Find the channel and let this member connect.
  const channel = roomChannel(interaction, roomId);
  if (!channel) {
    await failHere("ไม่เจอห้องนี้", "ห้องอาจถูกลบไปแล้ว");
    return;
  }
  try {
    await grantAccess(channel, interaction.user.id);
  } catch (error) {
    logBotError("grant access", error);
    await failHere("เข้าห้องไม่ได้", "บอทยังไม่มีสิทธิ์แก้ห้อง ลองบอกแอดมินดูนะ");
    return;
  }
  await interaction.editReply({
    embeds: [okEmbed("รหัสถูก", `เข้า ${channel} ได้เลย ออกแล้วกลับมาใหม่ก็ไม่ต้องใส่รหัสอีก`)],
    components: [linkRow(channel.guild.id, channel.id, "เข้าห้อง")],
  });
  expireLater(interaction, 60000);
}

// Manage
//
// Everything done from the owner's private panel edits that same panel, with a note on top
// saying what happened, so replies do not pile up. Opening the panel again from the room
// chat removes the previous one (Discord lets the bot do that for 15 minutes).

type Note = { tone: "ok" | "error"; title: string; text: string };
type Row = ReturnType<typeof purgeRow>;

function panelPayload(room: VoiceRoom, note?: Note, extraRows: Row[] = []) {
  const panel = managePanel(room, currentSettings().emptyDeleteMinutes);
  const embeds = note ? [(note.tone === "ok" ? okEmbed : errorEmbed)(note.title, note.text), ...panel.embeds] : panel.embeds;
  return { content: "", embeds, components: [...panel.components, ...extraRows] };
}

/** Buttons on the panel, and forms opened from them, update the panel instead of replying. */
async function beginPanelAction(interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction) {
  if (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage())) await interaction.deferUpdate();
  else {
    await interaction.deferReply({ flags: ephemeral });
    await newWindow(interaction);
  }
}

/** Shows what happened on the panel; if the room cannot be loaded any more, just the note. */
async function panelResult(interaction: RepliableInteraction, roomId: number, note: Note, room?: VoiceRoom, extraRows: Row[] = []) {
  try {
    const fresh = room ?? (await loadRoom(interaction, roomId)).room;
    await interaction.editReply(panelPayload(fresh, note, extraRows));
  } catch {
    await fail(interaction, note.title, note.text);
  }
}

async function showManage(interaction: RepliableInteraction, roomId: number, mode: "reply" | "update") {
  try {
    const { room } = await loadRoom(interaction, roomId);
    const payload = panelPayload(room);
    if (mode === "update" && interaction.isMessageComponent()) {
      await interaction.update(payload);
      return;
    }
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else {
      await interaction.reply({ ...payload, flags: ephemeral });
      await newWindow(interaction);
    }
  } catch (error) {
    if (apiStatus(error) !== 403) logBotError("manage room", error);
    await fail(interaction, "จัดการห้องไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"));
  }
}

async function manageCommand(interaction: ChatInputCommandInteraction) {
  const picked = interaction.options.getChannel("room");
  const member = interaction.member as GuildMember | null;
  const channelId = picked?.id ?? member?.voice?.channelId ?? "";
  const room = channelId ? roomByChannel(channelId) : undefined;
  if (room) {
    await showManage(interaction, room.id, "reply");
    return;
  }
  const owned = interaction.guild ? roomsOwnedBy(interaction.user.id, interaction.guild) : [];
  if (owned.length === 1) {
    await showManage(interaction, owned[0].id, "reply");
    return;
  }
  const text = owned.length
    ? `ห้องของคุณ: ${owned.map((item) => `<#${item.channelId}>`).join(" ")}\nพิมพ์ \`/room manage\` แล้วเลือกห้อง`
    : "ยังไม่มีห้องเลย สร้างได้ด้วย `/room create`";
  await interaction.reply({ flags: ephemeral, content: text });
  await newWindow(interaction);
  expireLater(interaction, 60000);
}

async function changePassword(interaction: ModalSubmitInteraction, roomId: number) {
  await beginPanelAction(interaction);
  try {
    const res = await api(interaction.user).patch<{ room: VoiceRoom; revoked: string[] }>(`/api/internal/bot/voice/rooms/${roomId}`, {
      password: interaction.fields.getTextInputValue("password"),
    });
    const channel = voiceChannel(interaction, res.data.room.channelId);
    if (channel) {
      for (const id of res.data.revoked) await revokeAccess(channel, id, res.data.room.ownerDiscordId);
    }
    const cached = channel ? roomByChannel(channel.id) : undefined;
    if (cached) cached.hasPassword = true;
    const inside = channel && res.data.room.locked ? channel.members.filter((member) => !member.user.bot && member.id !== res.data.room.ownerDiscordId).size : 0;
    const text = res.data.room.locked
      ? `${res.data.revoked.length} คนที่เคยใส่รหัสเก่าต้องใส่ใหม่${inside ? `\nยังมีคนอยู่ในห้อง ${inside} คน` : ""}`
      : "ห้องยังไม่ล็อก กด \"ล็อก\" เมื่อพร้อม";
    await panelResult(interaction, roomId, { tone: "ok", title: "เปลี่ยนรหัสแล้ว", text }, res.data.room, inside ? [purgeRow(roomId)] : []);
  } catch (error) {
    logBotError("change password", error);
    await panelResult(interaction, roomId, { tone: "error", title: "เปลี่ยนรหัสไม่ได้", text: apiMessage(error, "ลองใหม่อีกครั้ง") });
  }
}

/**
 * The room gets its first password and is locked. Anyone inside who has not given the
 * password is disconnected; only the owner stays.
 */
async function lockWithPassword(interaction: ModalSubmitInteraction, roomId: number) {
  await beginPanelAction(interaction);
  try {
    // Save the password first (that clears earlier access), then let in whoever is inside.
    const res = await api(interaction.user).patch<{ room: VoiceRoom }>(`/api/internal/bot/voice/rooms/${roomId}`, {
      password: interaction.fields.getTextInputValue("password"),
      locked: true,
    });
    const channel = voiceChannel(interaction, res.data.room.channelId);
    let removed = 0;
    if (channel) {
      await setLocked(channel, true, true);
      removed = await removeUnallowed(channel);
    }
    const { room } = await loadRoom(interaction, roomId);
    await panelResult(interaction, roomId, {
      tone: "ok",
      title: "ตั้งรหัสแล้ว",
      text: `ใครจะเข้าต้องใส่รหัสก่อน${removed ? `\nพาคนที่ยังไม่ได้ใส่รหัสออกไป ${removed} คน` : ""}`,
    }, room);
  } catch (error) {
    logBotError("lock with password", error);
    await panelResult(interaction, roomId, { tone: "error", title: "ล็อกห้องไม่ได้", text: apiMessage(error, "ลองใหม่อีกครั้ง") });
  }
}

async function editRoom(interaction: ModalSubmitInteraction, roomId: number) {
  await beginPanelAction(interaction);
  const limitText = interaction.fields.getTextInputValue("limit").trim();
  const userLimit = limitText ? Number(limitText) : 0;
  if (!Number.isInteger(userLimit) || userLimit < 0 || userLimit > 99) {
    await panelResult(interaction, roomId, { tone: "error", title: "จำนวนคนไม่ถูกต้อง", text: "ใส่ตัวเลข 1–99 หรือเว้นว่างไว้" });
    return;
  }
  try {
    const res = await api(interaction.user).patch<{ room: VoiceRoom }>(`/api/internal/bot/voice/rooms/${roomId}`, {
      name: interaction.fields.getTextInputValue("name"),
      userLimit,
    });
    const channel = voiceChannel(interaction, res.data.room.channelId);
    const cached = channel ? roomByChannel(channel.id) : undefined;
    if (cached) cached.name = res.data.room.name;
    // Discord allows two renames per ten minutes; don't keep the member waiting for a slow one.
    const edited = channel
      ? await Promise.race([
        channel.edit({ name: res.data.room.name, userLimit }).then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
      ]).catch(() => false)
      : false;
    await panelResult(interaction, roomId, {
      tone: "ok",
      title: "บันทึกแล้ว",
      text: edited ? "เปลี่ยนชื่อและจำนวนคนแล้ว" : "ชื่อใน Discord อาจเปลี่ยนช้าไปสักพัก",
    }, res.data.room);
  } catch (error) {
    logBotError("edit room", error);
    await panelResult(interaction, roomId, { tone: "error", title: "แก้ห้องไม่ได้", text: apiMessage(error, "ลองใหม่อีกครั้ง") });
  }
}

async function toggleLock(interaction: ButtonInteraction, roomId: number) {
  await beginPanelAction(interaction);
  try {
    const { room } = await loadRoom(interaction, roomId);
    const res = await api(interaction.user).patch<{ room: VoiceRoom }>(`/api/internal/bot/voice/rooms/${roomId}`, { locked: !room.locked });
    const channel = voiceChannel(interaction, res.data.room.channelId);
    let removed = 0;
    if (channel) {
      await setLocked(channel, res.data.room.locked, res.data.room.hasPassword);
      // Locking leaves only the owner and people who gave the password.
      if (res.data.room.locked) removed = await removeUnallowed(channel);
    }
    const out = removed ? `\nพาคนที่ยังไม่ได้ใส่รหัสออกไป ${removed} คน` : "";
    const note: Note = !res.data.room.locked
      ? { tone: "ok", title: "เปิดห้องแล้ว", text: "ตอนนี้ใครก็เข้าได้" }
      : res.data.room.hasPassword
        ? { tone: "ok", title: "ล็อกห้องแล้ว", text: `ใครจะเข้าต้องใส่รหัสก่อน${out}` }
        : { tone: "ok", title: "ปิดห้องแล้ว", text: `ตอนนี้มีแค่คุณที่เข้าได้${out}` };
    await panelResult(interaction, roomId, note);
  } catch (error) {
    logBotError("toggle lock", error);
    await panelResult(interaction, roomId, { tone: "error", title: "เปลี่ยนสถานะไม่ได้", text: apiMessage(error, "ลองใหม่อีกครั้ง") });
  }
}

async function kickMembers(interaction: UserSelectMenuInteraction, roomId: number) {
  await beginPanelAction(interaction);
  try {
    const { room } = await loadRoom(interaction, roomId);
    const channel = voiceChannel(interaction, room.channelId);
    const done: string[] = [];
    for (const userId of interaction.values) {
      if (userId === room.ownerDiscordId || userId === client.user?.id) continue;
      await api(interaction.user).post(`/api/internal/bot/voice/rooms/${roomId}/kick`, { discordId: userId, username: interaction.users.get(userId)?.username ?? "" });
      if (channel) {
        await revokeAccess(channel, userId, room.ownerDiscordId);
        const member = channel.members.get(userId);
        if (member && room.locked) await member.voice.disconnect("ถูกเจ้าของห้องเตะ").catch(() => undefined);
      }
      done.push(`<@${userId}>`);
    }
    await panelResult(interaction, roomId, done.length
      ? { tone: "ok", title: "เตะแล้ว", text: `${done.join(" ")} ต้องใส่รหัสใหม่ถึงจะกลับเข้ามาได้` }
      : { tone: "error", title: "ไม่มีใครโดนเตะ", text: "เตะเจ้าของห้องไม่ได้นะ" });
  } catch (error) {
    logBotError("kick", error);
    await panelResult(interaction, roomId, { tone: "error", title: "เตะไม่สำเร็จ", text: apiMessage(error, "ลองใหม่อีกครั้ง") });
  }
}

async function purgeRoom(interaction: ButtonInteraction, roomId: number) {
  await beginPanelAction(interaction);
  try {
    const { room } = await loadRoom(interaction, roomId);
    const channel = voiceChannel(interaction, room.channelId);
    const removed = channel ? await removeUnallowed(channel) : 0;
    await panelResult(interaction, roomId, { tone: "ok", title: "เตะออกแล้ว", text: `${removed} คนต้องใส่รหัสใหม่ถึงจะกลับเข้ามาได้` }, room);
  } catch (error) {
    logBotError("purge", error);
    await panelResult(interaction, roomId, { tone: "error", title: "ทำไม่สำเร็จ", text: apiMessage(error, "ลองใหม่อีกครั้ง") });
  }
}

async function removeRoom(interaction: ButtonInteraction, roomId: number) {
  await interaction.deferUpdate();
  try {
    const { room } = await loadRoom(interaction, roomId);
    await deleteRoom(voiceChannel(interaction, room.channelId), roomId, "owner", interaction.user);
    await interaction.editReply({ content: "", embeds: [okEmbed("ลบห้องแล้ว", `ลบ ${room.name} แล้ว`)], components: [] });
  } catch (error) {
    logBotError("delete room", error);
    await panelResult(interaction, roomId, { tone: "error", title: "ลบห้องไม่ได้", text: apiMessage(error, "ลองใหม่อีกครั้ง") });
  }
}

async function showVoiceHistory(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: ephemeral });
  await newWindow(interaction);
  const user = interaction.options.getUser("member") ?? interaction.user;
  const member = interaction.guild?.members.cache.get(user.id);
  try {
    const res = await api().get<{ sessions: VoiceSession[]; weekSeconds: number; monthSeconds: number }>("/api/internal/bot/voice/sessions/history", {
      params: { guildId: interaction.guildId, discordId: user.id },
    });
    await interaction.editReply({ embeds: [voiceHistoryEmbed(member?.displayName ?? user.username, res.data)], allowedMentions: { parse: [] } });
  } catch (error) {
    logBotError("voice history", error);
    await fail(interaction, "ดูประวัติไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"));
  }
}

async function showHistory(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: ephemeral });
  await newWindow(interaction);
  try {
    const res = await api(interaction.user).get<{ events: RoomEvent[] }>("/api/internal/bot/voice/history");
    await interaction.editReply({ embeds: [historyEmbed(res.data?.events ?? [])], allowedMentions: { parse: [] } });
  } catch (error) {
    logBotError("history", error);
    await fail(interaction, "ดูประวัติไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"));
  }
}

async function removeOldPanels(channel: TextBasedChannel) {
  if (!("messages" in channel)) return 0;
  const recent = await channel.messages.fetch({ limit: 50 });
  const old = recent.filter((message) => message.author.id === client.user?.id && JSON.stringify(message.components.map((row) => row.toJSON())).includes('"custom_id":"vr:create"'));
  for (const message of old.values()) await message.delete().catch(() => undefined);
  return old.size;
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isRepliable() || !interaction.inGuild()) return;
    const rate = checkRateLimit(interaction.user.id);
    if (!rate.allowed) {
      await fail(interaction, "ใจเย็นนิดนึง", `รออีก ${rate.waitSeconds || 1} วินาทีแล้วลองใหม่นะ`);
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-join-to-create") {
        const guild = interaction.guild;
        if (!guild) return;
        await interaction.deferReply({ flags: ephemeral });
        try {
          const hub = await createHubChannel(guild, await roomCategory(guild));
          await addPlace("hub", guild.id, hub.id, hub.name);
          void syncPlaces(client);
          await interaction.editReply({
            embeds: [okEmbed("สร้างแล้ว", `ใครเข้า ${hub} จะได้ห้องของตัวเองทันที\nย้าย ${hub} ไปหมวดไหนก็ได้ ห้องใหม่จะอยู่หมวดเดียวกัน`)],
          });
        } catch (error) {
          logBotError("setup hub", error);
          await fail(interaction, "สร้างไม่ได้", "บอทยังไม่มีสิทธิ์สร้างห้อง");
        }
        return;
      }
      if (interaction.commandName === "setup-room-log") {
        const channel = interaction.channel;
        if (!channel || !("send" in channel) || !interaction.guild) {
          await fail(interaction, "ตั้งไม่ได้", "ใช้คำสั่งนี้ในห้องข้อความ");
          return;
        }
        await interaction.deferReply({ flags: ephemeral });
        try {
          // Sending here first also checks the bot may post in this channel.
          const welcome = await buildMessage("log");
          const sent = await channel.send({ ...welcome.payload, flags: MessageFlags.SuppressNotifications });
          await addPlace("log", interaction.guild.id, channel.id, "name" in channel ? channel.name : "", sent.id, welcome.complete ? welcome.version : 0);
          await interaction.editReply({ content: "ได้แล้ว ต่อไปบอทจะส่ง log มาที่ห้องนี้ (ถ้าเคยตั้งห้องอื่นไว้ ห้องนั้นจะไม่ได้รับแล้ว)" });
        } catch (error) {
          logBotError("setup log", error);
          await fail(interaction, "ตั้งไม่ได้", "บอทไม่มีสิทธิ์ส่งข้อความในห้องนี้");
        }
        return;
      }
      if (interaction.commandName === "setup-voice-log") {
        const channel = interaction.channel;
        if (!channel || !("send" in channel) || !interaction.guild) {
          await fail(interaction, "ตั้งไม่ได้", "ใช้คำสั่งนี้ในห้องข้อความ");
          return;
        }
        await interaction.deferReply({ flags: ephemeral });
        try {
          const welcome = await buildMessage("voicelog");
          const sent = await channel.send({ ...welcome.payload, flags: MessageFlags.SuppressNotifications });
          await addPlace("voicelog", interaction.guild.id, channel.id, "name" in channel ? channel.name : "", sent.id, welcome.complete ? welcome.version : 0);
          await interaction.editReply({ content: "ได้แล้ว ต่อไปใครออกจากห้องเสียง บอทจะแจ้งที่ห้องนี้ (ถ้าเคยตั้งห้องอื่นไว้ ห้องนั้นจะไม่ได้รับแล้ว)" });
        } catch (error) {
          logBotError("setup voice log", error);
          await fail(interaction, "ตั้งไม่ได้", "บอทไม่มีสิทธิ์ส่งข้อความในห้องนี้");
        }
        return;
      }
      if (interaction.commandName === "setup-stop") {
        const channel = interaction.channel;
        if (!channel || channel.isDMBased()) return;
        await interaction.deferReply({ flags: ephemeral });
        try {
          const stopped = await stopUsing(channel);
          await interaction.editReply({
            content: stopped.length
              ? `บอทเลิกใช้ห้องนี้แล้ว (${stopped.join(", ")}) ลบห้องได้เลย บอทจะไม่สร้างคืน`
              : "ห้องนี้บอทไม่ได้ใช้อยู่ ลบได้เลย",
          });
        } catch (error) {
          logBotError("setup stop", error);
          await fail(interaction, "ทำไม่สำเร็จ", "ลองใหม่อีกทีนะ");
        }
        return;
      }
      if (interaction.commandName === "voice-history") {
        await showVoiceHistory(interaction);
        return;
      }
      if (interaction.commandName === "setup-room-panel") {
        const channel = interaction.channel;
        if (!channel || !("send" in channel)) {
          await fail(interaction, "ลงแผงไม่ได้", "ใช้คำสั่งนี้ในห้องข้อความ");
          return;
        }
        await interaction.deferReply({ flags: ephemeral });
        try {
          const removed = await removeOldPanels(channel).catch(() => 0);
          const panel = await buildMessage("panel");
          const sent = await channel.send(panel.payload);
          if (interaction.guild) {
            await addPlace("panel", interaction.guild.id, channel.id, "name" in channel ? channel.name : "", sent.id, panel.complete ? panel.version : 0)
              .catch((error) => logBotError("note panel", error));
          }
          await interaction.editReply({ content: removed ? "ลงแผงให้แล้ว แผงเก่าในห้องนี้ลบออกให้ด้วย" : "ลงแผงให้แล้ว" });
        } catch {
          await fail(interaction, "ลงแผงไม่ได้", "บอทไม่มีสิทธิ์ส่งข้อความในห้องนี้");
        }
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "create") await interaction.showModal(createModal());
      else if (sub === "join") await askPassword(interaction, interaction.options.getChannel("room", true).id);
      else if (sub === "manage") await manageCommand(interaction);
      else if (sub === "history") await showHistory(interaction);
      return;
    }

    if (interaction.isButton()) {
      const id = interaction.customId;
      const roomId = roomIdFrom(id);
      if (id === "vr:create" || id === "vr:find" || id === "vr:mine") notePanel(interaction.message);
      if (id === "vr:create") await interaction.showModal(createModal());
      else if (id === "vr:find") {
        const list = interaction.guild ? lockedRooms(interaction.guild, interaction.member as GuildMember) : [];
        if (list.length) await interaction.reply({ ...lockedRoomPicker(list), flags: ephemeral });
        else await interaction.reply({ flags: ephemeral, content: "ตอนนี้ยังไม่มีห้องที่ล็อกอยู่" });
        await newWindow(interaction);
        if (!list.length) expireLater(interaction, 30000);
      } else if (id === "vr:mine") {
        const owned = interaction.guild ? roomsOwnedBy(interaction.user.id, interaction.guild) : [];
        if (owned.length === 1) await showManage(interaction, owned[0].id, "reply");
        else {
          await interaction.reply({ flags: ephemeral, content: owned.length ? `ห้องของคุณ: ${owned.map((item) => `<#${item.channelId}>`).join(" ")}\nกด "จัดการห้อง" ในแชทของห้องนั้นได้เลย` : "ยังไม่มีห้องเลย กด \"สร้างห้อง\" ได้เลย" });
          await newWindow(interaction);
          expireLater(interaction, 60000);
        }
      } else if (id.startsWith("vr:join:")) {
        const entry = roomChannel(interaction, roomId);
        if (entry) await askPassword(interaction, entry.id);
        else await fail(interaction, "ไม่พบห้อง", "ห้องนี้อาจถูกลบไปแล้ว");
      } else if (id.startsWith("vr:manage:")) await showManage(interaction, roomId, interaction.message.flags.has(MessageFlags.Ephemeral) ? "update" : "reply");
      else if (id.startsWith("vr:newpw:")) await interaction.showModal(newPasswordModal(roomId));
      else if (id.startsWith("vr:lockpw:")) await interaction.showModal(newPasswordModal(roomId, "lock"));
      else if (id.startsWith("vr:edit:")) {
        try {
          const { room } = await loadRoom(interaction, roomId);
          await interaction.showModal(editModal(room));
        } catch (error) {
          await fail(interaction, "แก้ห้องไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"));
        }
      } else if (id.startsWith("vr:lock:")) await toggleLock(interaction, roomId);
      else if (id.startsWith("vr:del:")) await interaction.update({ embeds: [errorEmbed("ลบห้องนี้เลยไหม?", "ทุกคนในห้องจะหลุดออกหมด")], components: [confirmDeleteRow(roomId)] });
      else if (id.startsWith("vr:delok:")) await removeRoom(interaction, roomId);
      else if (id.startsWith("vr:purge:")) await purgeRoom(interaction, roomId);
      else await fail(interaction, "ปุ่มนี้หมดอายุแล้ว", "กดจากแผงห้องเสียงใหม่อีกทีนะ");
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "vr:pick") {
      await askPassword(interaction, interaction.values[0]);
      // Discord only reports a choice when it changes. Clear it, so the same room can be picked
      // again if the password form is closed without sending. The list was opened by the
      // member's current private message, whose token can edit it.
      const list = interaction.guild ? lockedRooms(interaction.guild, interaction.member as GuildMember) : [];
      const opener = windows.get(interaction.user.id)?.interaction;
      if (list.length && opener) {
        await opener.webhook.editMessage(interaction.message.id, { components: lockedRoomPicker(list).components }).catch(() => undefined);
      }
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith("vr:kick:")) {
      await kickMembers(interaction, roomIdFrom(interaction.customId));
      return;
    }

    if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id === "vr:create") await createRoom(interaction);
      else if (id.startsWith("vr:pw:")) await checkPassword(interaction, roomIdFrom(id));
      else if (id.startsWith("vr:newpw:")) await changePassword(interaction, roomIdFrom(id));
      else if (id.startsWith("vr:lockpw:")) await lockWithPassword(interaction, roomIdFrom(id));
      else if (id.startsWith("vr:edit:")) await editRoom(interaction, roomIdFrom(id));
    }
  } catch (error) {
    logBotError("interaction", error);
    if (interaction.isRepliable()) await fail(interaction, "มีอะไรผิดพลาดนิดหน่อย", "ลองใหม่อีกทีนะ").catch(() => undefined);
  }
});
