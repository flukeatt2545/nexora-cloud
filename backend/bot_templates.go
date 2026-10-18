package main

import "strings"

// botTemplateFiles is the starter bot offered when someone has no code yet: it logs in with the
// token from DISCORD_TOKEN and answers /ping, so the owner can see it work before writing more.
func botTemplateFiles(runtime, name string) map[string]sourceFile {
	if runtime == "python" {
		return map[string]sourceFile{
			"requirements.txt": {Data: []byte("discord.py>=2.4,<3\n")},
			"main.py":          {Data: []byte(pythonTemplate)},
			"README.md":        {Data: []byte(strings.ReplaceAll(templateReadme, "{{name}}", name))},
		}
	}
	return map[string]sourceFile{
		"package.json": {Data: []byte(nodePackageTemplate)},
		"index.js":     {Data: []byte(nodeTemplate)},
		"README.md":    {Data: []byte(strings.ReplaceAll(templateReadme, "{{name}}", name))},
	}
}

const templateReadme = `# {{name}}

บอทตัวอย่างที่ตอบคำสั่ง /ping

- โทเคนบอทอ่านจากตัวแปร DISCORD_TOKEN (ตั้งในแท็บตัวแปรลับ ไม่ต้องใส่ในโค้ด)
- ไฟล์ที่ต้องอยู่ถาวร เช่นข้อมูลหรือฐานข้อมูล SQLite ให้เก็บในโฟลเดอร์ที่ตัวแปร DATA_DIR ชี้ไป
  โฟลเดอร์โค้ดจะถูกสร้างใหม่ทุกครั้งที่อัปโหลดโค้ด
`

const nodePackageTemplate = `{
  "name": "discord-bot",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "dependencies": {
    "discord.js": "^14.16.0"
  }
}
`

const nodeTemplate = `const { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("ยังไม่ได้ตั้งโทเคน: ใส่โทเคนบอทในแท็บตัวแปรลับ ชื่อ DISCORD_TOKEN");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [new SlashCommandBuilder().setName("ping").setDescription("ดูว่าบอทยังตอบอยู่ไหม")];

client.once(Events.ClientReady, async (ready) => {
  console.log("ออนไลน์แล้วในชื่อ " + ready.user.tag);
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(ready.user.id), { body: commands.map((command) => command.toJSON()) });
  console.log("ลงทะเบียนคำสั่ง /ping แล้ว");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "ping") {
    await interaction.reply("pong " + client.ws.ping + "ms");
  }
});

client.login(token);
`

const pythonTemplate = `import os
import sys

import discord
from discord import app_commands

token = os.environ.get("DISCORD_TOKEN")
if not token:
    print("ยังไม่ได้ตั้งโทเคน: ใส่โทเคนบอทในแท็บตัวแปรลับ ชื่อ DISCORD_TOKEN", file=sys.stderr)
    sys.exit(1)

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


@tree.command(name="ping", description="ดูว่าบอทยังตอบอยู่ไหม")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message(f"pong {round(client.latency * 1000)}ms")


@client.event
async def on_ready():
    await tree.sync()
    print(f"ออนไลน์แล้วในชื่อ {client.user}")
    print("ลงทะเบียนคำสั่ง /ping แล้ว")


client.run(token, log_handler=None)
`
