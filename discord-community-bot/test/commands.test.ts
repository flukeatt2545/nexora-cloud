import "./support";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import { commands } from "../src/commands";

const byName = new Map(commands.map((command) => [command.name, command.toJSON()]));
const command = (name: string) => byName.get(name)!;

test("admin commands are hidden from members without Manage Server", () => {
  for (const name of ["setup", "create", "protect"]) {
    assert.equal(command(name).default_member_permissions, String(PermissionFlagsBits.ManageGuild), name);
  }
});

test("/clear is only shown to people who can manage messages", () => {
  assert.equal(command("clear").default_member_permissions, String(PermissionFlagsBits.ManageMessages));
});

test("/ticket stays visible to every member (they close their own tickets)", () => {
  assert.equal(command("ticket").default_member_permissions, undefined);
});

test("/clear has no True/False option that members would have to guess", () => {
  const types = command("clear").options!.map((option) => option.type);
  assert.ok(!types.includes(ApplicationCommandOptionType.Boolean));
});

test("/clear offers both ways to clear every room, and the stricter one is listed first", () => {
  const scope = command("clear").options!.find((option) => option.name === "scope");
  assert.ok(scope && "choices" in scope && scope.choices);
  assert.deepEqual(scope.choices.map((choice) => choice.value), ["full", "all"]);
});

test("every command can be told apart in Thai and English", () => {
  const names = commands.map((item) => item.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(command("clear").name_localizations?.th, "ลบข้อความ");
});
