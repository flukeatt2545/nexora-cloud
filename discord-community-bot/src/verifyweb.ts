import { type Client } from "discord.js";
import { assignable } from "./access";
import { api, logBotError } from "./api";
import { homeGuild } from "./guild";
import { settings } from "./settings";

// Verifying on the website: the site queues each member who passed (backend/discord_verify.go)
// and the bot gives them the member role. Members who clicked the button without passing never
// show up here.

type Passed = { id: number; userId: string; username: string };

const tries = new Map<number, number>();
const MAX_TRIES = 5;
let running = false;

/** Gives the member role to everyone the site says passed, then tells the site it is done. */
export async function giveVerifiedRoles(client: Client) {
  if (running) return;
  running = true;
  try {
    const guild = homeGuild(client);
    const roleId = settings()?.memberRoleId;
    if (!guild || !roleId) return;
    const res = await api().get<{ items: Passed[] }>("/api/internal/bot/community/verify/results");
    const done: number[] = [];
    for (const item of res.data.items) {
      const member = await guild.members.fetch(item.userId).catch(() => null);
      // Someone who left in the meantime has nothing to receive.
      if (!member) {
        done.push(item.id);
        continue;
      }
      if (member.roles.cache.has(roleId)) {
        done.push(item.id);
        continue;
      }
      try {
        if (!assignable(guild, roleId)) throw new Error("the member role is above the bot's own role");
        await member.roles.add(roleId, "ยืนยันตัวตนผ่านเว็บ");
        done.push(item.id);
      } catch (error) {
        // A hiccup is tried again on the next round; a member who cannot be given the role is let go after a few.
        const count = (tries.get(item.id) ?? 0) + 1;
        tries.set(item.id, count);
        logBotError("verify role", error);
        if (count >= MAX_TRIES) done.push(item.id);
      }
    }
    if (done.length) {
      await api().post("/api/internal/bot/community/verify/results/ack", { ids: done });
      for (const id of done) tries.delete(id);
    }
  } finally {
    running = false;
  }
}

export function startVerifyResults(client: Client) {
  setInterval(() => void giveVerifiedRoles(client).catch((error) => logBotError("verify results", error)), 4000).unref();
}
