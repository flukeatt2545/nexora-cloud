import {
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { api, apiMessage, logBotError, type MailBotSettings } from "./api";
import { isMailSystemAdmin } from "./config";
import { checkPrivilegedRateLimit } from "./limits";
import {
  COLOR,
  MAILBOX_ID_RE,
  PUBLIC_ID_RE,
  begin,
  button,
  clip,
  errorEmbed,
  facts,
  formatBytes,
  plain,
  row,
  thaiTime,
  type Edit,
  type Interaction,
} from "./ui";

/*
 * Custom IDs (admins only, private):
 *   a:home  a:new  a:search  a:list:<page>:<query>  a:pick  a:box:<box>
 *   a:suspend:<box>  a:suspendyes:<box>  a:resume:<box>  a:bind:<box>  a:bindpick:<box>  a:unbind:<box>
 *   a:delete:<box> (modal a:delsubmit:<box>)
 *   a:domains  a:dompick  a:dom:<id>  a:domok:<id>  a:domsus:<id>  a:domsusyes:<id>
 *   a:settings (modal a:setsubmit)
 * Public admin panel button: mailadm:open
 */

type Mode = "update" | "reply";

type AdminMailbox = {
  id: string;
  address: string;
  displayName: string;
  status: string;
  quotaBytes: number;
  createdAt: string;
  owner: string;
  discordBindings?: number;
};

type AdminMailboxDetail = AdminMailbox & {
  provisionState: string;
  bindings: { discordUserId: string; username: string }[];
  appPasswords: number;
  members: number;
};

type AdminDomain = { id: string; domain: string; kind: string; status: string; verified: boolean; owner: string; mailboxes: number };

const STATUS: Record<string, string> = {
  active: "ใช้งาน",
  suspended: "ระงับ",
  pending_dns: "รอตั้ง DNS",
  pending_approval: "รออนุมัติ",
  failed: "ผิดพลาด",
};

const WRITE_ACTIONS = new Set([
  "suspendyes",
  "resume",
  "bindpick",
  "unbind",
  "domok",
  "domsusyes",
  "newsubmit",
  "delsubmit",
  "setsubmit",
]);

function statusLabel(status: string) {
  return STATUS[status] || status;
}

function adminFailure(edit: Edit, scope: string, title: string, error: unknown, back = "a:home") {
  logBotError(scope, error);
  return edit({
    embeds: [errorEmbed(title, apiMessage(error, "ลองใหม่ในอีกสักครู่"))],
    components: [row(button(back, "กลับ"), button("a:home", "หน้าแรก"))],
  });
}

async function denied(interaction: Interaction, text: string) {
  const payload = { flags: MessageFlags.Ephemeral as const, embeds: [errorEmbed("ทำรายการไม่ได้", text)] };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

/** Admin check for every admin interaction; writes also get the stricter rate limit. */
async function allowed(interaction: Interaction, action: string) {
  if (!isMailSystemAdmin(interaction.user.id)) {
    await denied(interaction, "ใช้ได้เฉพาะผู้ดูแลระบบเมลที่ได้รับอนุญาต");
    return false;
  }
  if (WRITE_ACTIONS.has(action)) {
    const limit = checkPrivilegedRateLimit(interaction.user.id);
    if (!limit.allowed) {
      await denied(interaction, `รออีก ${limit.waitSeconds || 10} วินาที แล้วลองใหม่`);
      return false;
    }
  }
  return true;
}

// ---------- Home ----------

async function renderHome(edit: Edit, adminId: string, notice = "") {
  try {
    const res = await api(adminId).get("/api/internal/bot/mail/admin-summary");
    const data = res.data as {
      domains: number;
      mailboxes: number;
      pending: number;
      suspended: number;
      stalwart: boolean;
      settings: MailBotSettings;
    };
    const settings = data.settings;
    const selfService = settings.selfServiceEnabled
      ? `เปิด · คนละ ${settings.maxMailboxesPerUser} กล่อง · กล่องละ ${formatBytes(settings.quotaBytes)}`
      : "ปิด";
    const todo: string[] = [];
    if (!data.stalwart) todo.push("เซิร์ฟเวอร์เมลติดต่อไม่ได้ ตรวจที่หน้าเว็บ /admin/mail");
    if (data.pending > 0) todo.push(`มีโดเมนรออนุมัติ ${data.pending} รายการ กด **โดเมน**`);
    const embed = new EmbedBuilder()
      .setTitle("จัดการระบบเมล")
      .setColor(data.stalwart && data.pending === 0 ? COLOR.brand : COLOR.warn)
      .setDescription(
        [
          facts([
            ["เซิร์ฟเวอร์เมล", data.stalwart ? "ปกติ" : "ติดต่อไม่ได้"],
            ["โดเมน", `${data.domains}${data.pending ? ` · รออนุมัติ ${data.pending}` : ""}`],
            ["กล่องเมล", `${data.mailboxes}${data.suspended ? ` · ระงับ ${data.suspended}` : ""}`],
            ["สมาชิกสร้างเอง", selfService],
          ]),
          todo.length ? `\n${todo.map((item) => `> ${item}`).join("\n")}` : "",
        ].join("")
      );
    await edit({
      content: notice,
      embeds: [embed],
      components: [
        row(button("a:new", "สร้างกล่อง", ButtonStyle.Primary), button("a:search", "ค้นหา"), button("a:list:0:", "ทุกกล่อง")),
        row(button("a:domains", "โดเมน"), button("a:settings", "ตั้งค่า"), button("a:home", "รีเฟรช")),
      ],
    });
  } catch (error) {
    await adminFailure(edit, "admin-home", "เปิดหน้าแอดมินไม่สำเร็จ", error, "a:home");
  }
}

export async function showAdminHome(interaction: Interaction, mode: Mode) {
  if (!(await allowed(interaction, "home"))) return;
  const edit = await begin(interaction, mode, "admin");
  await renderHome(edit, interaction.user.id);
}

// ---------- Mailboxes ----------

async function renderList(edit: Edit, adminId: string, page: number, query: string, notice = "") {
  let data: { items: AdminMailbox[]; hasMore: boolean };
  try {
    const res = await api(adminId).get("/api/internal/bot/mail/admin/mailboxes", { params: { q: query, page } });
    data = res.data;
  } catch (error) {
    await adminFailure(edit, "admin-list", "โหลดรายการไม่สำเร็จ", error);
    return;
  }
  const lines = data.items.map((box) => {
    const owner = box.owner ? `เจ้าของ ${plain(box.owner)}` : "ไม่มีเจ้าของ";
    const flag = box.status === "active" ? "" : `  \`${statusLabel(box.status)}\``;
    return `**${box.address}**${flag}\n${owner} · ${formatBytes(box.quotaBytes)}`;
  });
  const embed = new EmbedBuilder()
    .setTitle(query ? `ผลการค้นหา "${clip(query, 40)}"` : "กล่องเมลทั้งหมด")
    .setColor(COLOR.brand)
    .setDescription(lines.length ? lines.join("\n\n") : query ? "ไม่พบกล่องที่ตรงกับคำค้น" : "ยังไม่มีกล่องเมล")
    .setFooter({ text: `หน้า ${page + 1} · เลือกกล่องจากเมนูด้านล่างเพื่อจัดการ` });
  const components = [];
  if (data.items.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId("a:pick")
          .setPlaceholder("เลือกกล่องเพื่อจัดการ")
          .addOptions(
            data.items.map((box) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(box.address, 100))
                .setDescription(clip(`${box.owner || "ไม่มีเจ้าของ"} · ${statusLabel(box.status)}`, 100))
                .setValue(box.id)
            )
          )
      )
    );
  }
  const q = clip(query, 40);
  components.push(
    row(
      button(`a:list:${Math.max(page - 1, 0)}:${q}`, "ก่อนหน้า", ButtonStyle.Secondary, page === 0),
      button(`a:list:${page + 1}:${q}`, "ถัดไป", ButtonStyle.Secondary, !data.hasMore),
      button("a:search", "ค้นหา"),
      button("a:home", "หน้าแรก")
    )
  );
  await edit({ content: notice, embeds: [embed], components });
}

async function renderMailbox(edit: Edit, adminId: string, box: string, notice = "") {
  let data: AdminMailboxDetail;
  try {
    const res = await api(adminId).get(`/api/internal/bot/mail/admin/mailboxes/${box}`);
    data = res.data;
  } catch (error) {
    await adminFailure(edit, "admin-mailbox", "เปิดกล่องไม่สำเร็จ", error, "a:list:0:");
    return;
  }
  const bound = data.bindings.length ? data.bindings.map((item) => `<@${item.discordUserId}>`).join(" ") : "ยังไม่มี";
  const embed = new EmbedBuilder()
    .setTitle(data.address)
    .setColor(data.status === "active" ? COLOR.brand : COLOR.warn)
    .setDescription(
      [
        facts([
          ["สถานะ", statusLabel(data.status)],
          ["เจ้าของ", data.owner ? plain(data.owner) : "ไม่มี"],
          ["พื้นที่", formatBytes(data.quotaBytes)],
          ["รหัสผ่านแอป", `${data.appPasswords} อัน`],
          ["เซิร์ฟเวอร์เมล", data.provisionState === "provisioned" ? "พร้อมใช้" : data.provisionState || "-"],
        ]),
        `สร้างเมื่อ ${thaiTime(data.createdAt, "date")}`,
        "",
        `**ดูผ่านบอทได้ (Discord)**\n${bound}`,
      ].join("\n")
    );
  const actions =
    data.status === "active"
      ? [button(`a:suspend:${box}`, "ระงับ")]
      : [button(`a:resume:${box}`, "เปิดใช้งาน", ButtonStyle.Success)];
  actions.push(button(`a:bind:${box}`, "เพิ่มคนดูเมล"), button(`a:delete:${box}`, "ลบ", ButtonStyle.Danger));
  const components = [row(...actions)];
  if (data.bindings.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`a:unbind:${box}`)
          .setPlaceholder("เอาคนออกจากกล่องนี้")
          .addOptions(
            data.bindings.map((item) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(item.username || item.discordUserId, 100))
                .setDescription(item.discordUserId)
                .setValue(item.discordUserId)
            )
          )
      )
    );
  }
  components.push(row(button("a:list:0:", "ทุกกล่อง"), button("a:home", "หน้าแรก")));
  await edit({ content: notice, embeds: [embed], components });
}

/**
 * Modals opened from the panel in the channel carry ":reply" so their result opens a new
 * private window instead of editing the shared panel.
 */
function modalId(base: string, mode: Mode) {
  return mode === "reply" ? `${base}:reply` : base;
}

function searchModal(mode: Mode) {
  return new ModalBuilder()
    .setCustomId(modalId("a:searchsubmit", mode))
    .setTitle("ค้นหากล่องเมล")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("ที่อยู่อีเมลหรือชื่อบัญชีเว็บ")
        .setDescription("พิมพ์บางส่วนก็ได้ เช่น somchai หรือ @nkn02.com")
        .setTextInputComponent(new TextInputBuilder().setCustomId("q").setStyle(TextInputStyle.Short).setMaxLength(40))
    );
}

async function openSettingsModal(interaction: ButtonInteraction, mode: Mode) {
  let settings: MailBotSettings;
  try {
    settings = (await api(interaction.user.id).get("/api/internal/bot/mail/admin/settings", { timeout: 2500 })).data;
  } catch (error) {
    logBotError("admin-settings", error);
    await denied(interaction, "โหลดการตั้งค่าไม่สำเร็จ ลองใหม่อีกครั้ง");
    return;
  }
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(modalId("a:setsubmit", mode))
      .setTitle("ให้สมาชิกสร้างเมลเอง")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("สร้างเมลเองบนโดเมนกลาง")
          .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId("enabled")
              .addOptions(
                new StringSelectMenuOptionBuilder().setLabel("เปิด").setValue("on").setDefault(settings.selfServiceEnabled),
                new StringSelectMenuOptionBuilder().setLabel("ปิด").setValue("off").setDefault(!settings.selfServiceEnabled)
              )
          ),
        new LabelBuilder()
          .setLabel("สร้างได้กี่กล่องต่อคน")
          .setDescription("0 ถึง 50")
          .setTextInputComponent(
            new TextInputBuilder().setCustomId("max").setStyle(TextInputStyle.Short).setMaxLength(2).setValue(String(settings.maxMailboxesPerUser))
          ),
        new LabelBuilder()
          .setLabel("พื้นที่ต่อกล่อง (GB)")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId("quota")
              .setStyle(TextInputStyle.Short)
              .setMaxLength(6)
              .setValue(String(Number((settings.quotaBytes / 1024 ** 3).toFixed(2))))
          )
      )
  );
}

/** The panel posted in the admin channel by /setup-mail-admin-panel. */
export function adminPanelMessage() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("จัดการระบบเมล")
        .setColor(COLOR.brand)
        .setDescription(
          [
            "**สร้างกล่อง** เปิดกล่องเมลใหม่ให้สมาชิก",
            "**ค้นหา / ทุกกล่อง** ดูกล่องเมล ระงับ ลบ หรือเพิ่มคนดูเมล",
            "**โดเมน** อนุมัติหรือระงับโดเมน",
            "**ตั้งค่า** กำหนดให้สมาชิกสร้างเมลเองได้กี่กล่อง",
            "**ภาพรวม** สถานะเซิร์ฟเวอร์และจำนวนกล่องทั้งหมด",
          ].join("\n")
        )
        .setFooter({ text: "ใช้ได้เฉพาะผู้ดูแลระบบเมล · หน้าต่างที่เปิดเห็นเฉพาะคนที่กด" }),
    ],
    components: [
      row(button("mailadm:new", "สร้างกล่อง", ButtonStyle.Primary), button("mailadm:search", "ค้นหา"), button("mailadm:list", "ทุกกล่อง")),
      row(button("mailadm:domains", "โดเมน"), button("mailadm:settings", "ตั้งค่า"), button("mailadm:open", "ภาพรวม")),
    ],
  };
}

/** Buttons on the admin channel panel: each opens its own private window or form. */
export async function handleAdminPanelButton(interaction: ButtonInteraction) {
  const action = interaction.customId.split(":")[1] || "open";
  if (!(await allowed(interaction, action))) return;
  if (action === "new") {
    await openCreateModal(interaction, "reply");
    return;
  }
  if (action === "search") {
    await interaction.showModal(searchModal("reply"));
    return;
  }
  if (action === "settings") {
    await openSettingsModal(interaction, "reply");
    return;
  }
  const edit = await begin(interaction, "reply", "admin");
  if (action === "list") await renderList(edit, interaction.user.id, 0, "");
  else if (action === "domains") await renderDomains(edit, interaction.user.id);
  else await renderHome(edit, interaction.user.id);
}

async function openCreateModal(interaction: ButtonInteraction, mode: Mode) {
  let domains: AdminDomain[];
  try {
    const res = await api(interaction.user.id).get("/api/internal/bot/mail/admin/domains", { timeout: 2500 });
    domains = (res.data.items as AdminDomain[]).filter((domain) => domain.status === "active");
  } catch (error) {
    logBotError("admin-domains", error);
    await denied(interaction, "โหลดรายชื่อโดเมนไม่สำเร็จ ลองใหม่อีกครั้ง");
    return;
  }
  if (!domains.length) {
    await denied(interaction, "ยังไม่มีโดเมนที่เปิดใช้งาน อนุมัติโดเมนก่อน");
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(modalId("a:newsubmit", mode))
    .setTitle("สร้างกล่องเมลให้ผู้ใช้")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("โดเมน")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("domain")
            .addOptions(
              domains.slice(0, 25).map((domain, index) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(`@${domain.domain}`)
                  .setValue(domain.id)
                  .setDescription(domain.kind === "platform" ? "โดเมนกลาง" : `ของ ${domain.owner || "-"}`)
                  .setDefault(index === 0)
              )
            )
        ),
      new LabelBuilder()
        .setLabel("ชื่ออีเมล (ส่วนหน้า @)")
        .setTextInputComponent(new TextInputBuilder().setCustomId("local").setStyle(TextInputStyle.Short).setMaxLength(64)),
      new LabelBuilder()
        .setLabel("ให้ใครใช้ (Discord)")
        .setDescription("ถ้าคนนี้ยังไม่ได้ล็อกอินเว็บ จะผูกให้ดูเมลผ่านบอทได้")
        .setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId("owner").setRequired(false).setMaxValues(1)),
      new LabelBuilder()
        .setLabel("หรือชื่อบัญชีเว็บของเจ้าของ")
        .setDescription("เว้นว่างได้ ถ้าไม่ระบุทั้งสองช่อง กล่องจะเป็นของคุณ")
        .setTextInputComponent(new TextInputBuilder().setCustomId("username").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)),
      new LabelBuilder()
        .setLabel("พื้นที่ (GB)")
        .setDescription("เว้นว่าง = 1 GB")
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("quota").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(6).setPlaceholder("1")
        )
    );
  await interaction.showModal(modal);
}

// ---------- Domains ----------

async function loadDomains(adminId: string) {
  const res = await api(adminId).get("/api/internal/bot/mail/admin/domains");
  return res.data.items as AdminDomain[];
}

async function renderDomains(edit: Edit, adminId: string, notice = "") {
  let domains: AdminDomain[];
  try {
    domains = await loadDomains(adminId);
  } catch (error) {
    await adminFailure(edit, "admin-domains", "โหลดโดเมนไม่สำเร็จ", error);
    return;
  }
  const lines = domains.map((domain) => {
    const kind = domain.kind === "platform" ? "โดเมนกลาง" : `ของ ${plain(domain.owner || "-")}`;
    return `**${domain.domain}**  \`${statusLabel(domain.status)}\`\n${kind} · ${domain.mailboxes} กล่อง`;
  });
  const embed = new EmbedBuilder()
    .setTitle("โดเมน")
    .setColor(COLOR.brand)
    .setDescription(lines.length ? lines.join("\n\n") : "ยังไม่มีโดเมน")
    .setFooter({ text: "การเพิ่มโดเมนและตั้งค่า DNS ทำในหน้าเว็บ /admin/mail" });
  const components = [];
  if (domains.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId("a:dompick")
          .setPlaceholder("เลือกโดเมนเพื่ออนุมัติหรือระงับ")
          .addOptions(
            domains.map((domain) =>
              new StringSelectMenuOptionBuilder().setLabel(clip(domain.domain, 100)).setDescription(statusLabel(domain.status)).setValue(domain.id)
            )
          )
      )
    );
  }
  components.push(row(button("a:domains", "รีเฟรช"), button("a:home", "หน้าแรก")));
  await edit({ content: notice, embeds: [embed], components });
}

async function renderDomain(edit: Edit, adminId: string, id: string) {
  let domain: AdminDomain | undefined;
  try {
    domain = (await loadDomains(adminId)).find((item) => item.id === id);
  } catch (error) {
    await adminFailure(edit, "admin-domain", "โหลดโดเมนไม่สำเร็จ", error, "a:domains");
    return;
  }
  if (!domain) {
    await edit({ embeds: [errorEmbed("ไม่พบโดเมนนี้", "อาจถูกลบไปแล้ว")], components: [row(button("a:domains", "กลับ"))] });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle(domain.domain)
    .setColor(domain.status === "active" ? COLOR.brand : COLOR.warn)
    .setDescription(
      [
        facts([
          ["สถานะ", statusLabel(domain.status)],
          ["DNS", domain.verified ? "ยืนยันแล้ว" : "ยังไม่ผ่าน"],
          ["ประเภท", domain.kind === "platform" ? "โดเมนกลาง" : "โดเมนของผู้ใช้"],
          ["เจ้าของ", plain(domain.owner || "-")],
          ["กล่องเมล", String(domain.mailboxes)],
        ]),
        !domain.verified && domain.status !== "active" ? "\n> ต้องตั้ง DNS ให้ผ่านในหน้าเว็บก่อน จึงจะอนุมัติได้" : "",
      ].join("")
    );
  const actions = [];
  if (domain.status === "active") actions.push(button(`a:domsus:${domain.id}`, "ระงับโดเมน", ButtonStyle.Danger));
  else actions.push(button(`a:domok:${domain.id}`, "อนุมัติ", ButtonStyle.Success, !domain.verified));
  actions.push(button("a:domains", "กลับ"));
  await edit({ embeds: [embed], components: [row(...actions)] });
}

// ---------- Routing ----------

function parsePage(value: string | undefined) {
  const page = Number.parseInt(value || "0", 10);
  return Number.isFinite(page) && page >= 0 && page <= 500 ? page : 0;
}

export async function handleAdminComponent(interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction) {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  if (!(await allowed(interaction, action))) return;
  const adminId = interaction.user.id;
  const box = parts[2] || "";

  // Modals have to be the first response, so they open before anything is deferred.
  if (interaction.isButton()) {
    if (action === "new") {
      await openCreateModal(interaction, "update");
      return;
    }
    if (action === "search") {
      await interaction.showModal(searchModal("update"));
      return;
    }
    if (action === "delete" && MAILBOX_ID_RE.test(box)) {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`a:delsubmit:${box}`)
          .setTitle("ลบกล่องเมล")
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("ลบแล้วกู้คืนไม่ได้ จดหมายทั้งหมดในกล่องจะหายถาวร และแอปที่ใช้กล่องนี้จะเข้าไม่ได้")
          )
          .addLabelComponents(
            new LabelBuilder()
              .setLabel("พิมพ์ที่อยู่อีเมลของกล่องเพื่อยืนยัน")
              .setTextInputComponent(new TextInputBuilder().setCustomId("confirm").setStyle(TextInputStyle.Short).setMaxLength(160))
          )
      );
      return;
    }
    if (action === "settings") {
      await openSettingsModal(interaction, "update");
      return;
    }
  }

  const edit = await begin(interaction, "update");
  switch (action) {
    case "home":
      await renderHome(edit, adminId);
      return;
    case "list":
      await renderList(edit, adminId, parsePage(parts[2]), parts.slice(3).join(":"));
      return;
    case "pick":
      if (interaction.isStringSelectMenu() && MAILBOX_ID_RE.test(interaction.values[0] || "")) {
        await renderMailbox(edit, adminId, interaction.values[0]);
      }
      return;
    case "box":
      if (MAILBOX_ID_RE.test(box)) await renderMailbox(edit, adminId, box);
      return;
    case "suspend":
      if (!MAILBOX_ID_RE.test(box)) return;
      await edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("ระงับกล่องนี้?")
            .setColor(COLOR.warn)
            .setDescription(
              "เจ้าของจะเปิดกล่องในเว็บและบอทไม่ได้ และรหัสผ่านแอปทุกอันจะถูกยกเลิก (เปิดใช้อีกครั้งแล้วต้องสร้างรหัสใหม่)\nเมลที่ส่งเข้ามาระหว่างนี้ยังเก็บไว้ในกล่อง"
            ),
        ],
        components: [row(button(`a:suspendyes:${box}`, "ระงับ", ButtonStyle.Danger), button(`a:box:${box}`, "ไม่ระงับ"))],
      });
      return;
    case "suspendyes":
    case "resume": {
      if (!MAILBOX_ID_RE.test(box)) return;
      const path = action === "resume" ? "resume" : "suspend";
      try {
        const res = await api(adminId).post(`/api/internal/bot/mail/admin/mailboxes/${box}/${path}`);
        const notice =
          action === "resume"
            ? "เปิดใช้กล่องอีกครั้งแล้ว"
            : `ระงับแล้ว · ยกเลิกรหัสผ่านแอป ${res.data.appPasswordsRevoked ?? 0} อัน`;
        await renderMailbox(edit, adminId, box, notice);
      } catch (error) {
        await adminFailure(edit, "admin-status", "เปลี่ยนสถานะไม่สำเร็จ", error, `a:box:${box}`);
      }
      return;
    }
    case "bind":
      if (!MAILBOX_ID_RE.test(box)) return;
      await edit({
        embeds: [new EmbedBuilder().setTitle("เพิ่มคนดูเมลกล่องนี้").setColor(COLOR.brand).setDescription("คนที่เลือกจะเปิดอ่านเมลกล่องนี้ผ่านบอทได้ แต่ไม่ได้เป็นเจ้าของกล่อง")],
        components: [
          row(new UserSelectMenuBuilder().setCustomId(`a:bindpick:${box}`).setPlaceholder("เลือกสมาชิก").setMaxValues(1)),
          row(button(`a:box:${box}`, "ยกเลิก")),
        ],
      });
      return;
    case "bindpick":
    case "unbind": {
      if (!MAILBOX_ID_RE.test(box)) return;
      try {
        const detail = (await api(adminId).get(`/api/internal/bot/mail/admin/mailboxes/${box}`)).data as AdminMailboxDetail;
        let notice = "";
        if (action === "bindpick" && interaction.isUserSelectMenu()) {
          const user = interaction.users.first();
          if (!user) return;
          await api(adminId).post("/api/internal/bot/mail/bind", {
            discordUserId: user.id,
            discordUsername: user.username,
            address: detail.address,
          });
          notice = `เพิ่ม ${user} แล้ว`;
        } else if (action === "unbind" && interaction.isStringSelectMenu()) {
          const discordUserId = interaction.values[0] || "";
          await api(adminId).delete("/api/internal/bot/mail/bind", { data: { discordUserId, address: detail.address } });
          notice = `เอา <@${discordUserId}> ออกแล้ว`;
        }
        await renderMailbox(edit, adminId, box, notice);
      } catch (error) {
        await adminFailure(edit, "admin-bind", "ผูก/ปลด Discord ไม่สำเร็จ", error, `a:box:${box}`);
      }
      return;
    }
    case "domains":
      await renderDomains(edit, adminId);
      return;
    case "dompick":
      if (interaction.isStringSelectMenu() && PUBLIC_ID_RE.test(interaction.values[0] || "")) {
        await renderDomain(edit, adminId, interaction.values[0]);
      }
      return;
    case "dom":
      if (PUBLIC_ID_RE.test(box)) await renderDomain(edit, adminId, box);
      return;
    case "domsus":
      if (!PUBLIC_ID_RE.test(box)) return;
      await edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("ระงับโดเมนนี้?")
            .setColor(COLOR.warn)
            .setDescription("ทุกกล่องในโดเมนนี้จะรับส่งเมลและเปิดดูไม่ได้จนกว่าจะอนุมัติใหม่"),
        ],
        components: [row(button(`a:domsusyes:${box}`, "ระงับโดเมน", ButtonStyle.Danger), button(`a:dom:${box}`, "ไม่ระงับ"))],
      });
      return;
    case "domok":
    case "domsusyes": {
      if (!PUBLIC_ID_RE.test(box)) return;
      const status = action === "domok" ? "active" : "suspended";
      try {
        await api(adminId).patch(`/api/internal/bot/mail/admin/domains/${box}/status`, { status });
        await renderDomains(edit, adminId, status === "active" ? "อนุมัติโดเมนแล้ว" : "ระงับโดเมนแล้ว");
      } catch (error) {
        await adminFailure(edit, "admin-domain-status", "เปลี่ยนสถานะโดเมนไม่สำเร็จ", error, `a:dom:${box}`);
      }
      return;
    }
    default:
      await edit({ content: "เมนูนี้หมดอายุแล้ว พิมพ์ /mail-admin เพื่อเปิดใหม่" });
  }
}

export async function handleAdminModal(interaction: ModalSubmitInteraction) {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  if (!(await allowed(interaction, action))) return;
  const adminId = interaction.user.id;
  // Forms opened from the channel panel answer in a new private window (see modalId).
  const edit = await begin(interaction, parts[2] === "reply" ? "reply" : "update", "admin");

  if (action === "searchsubmit") {
    await renderList(edit, adminId, 0, interaction.fields.getTextInputValue("q").trim());
    return;
  }
  if (action === "newsubmit") {
    const quotaText = interaction.fields.getTextInputValue("quota").trim();
    const quotaGb = quotaText ? Number(quotaText.replace(",", ".")) : 0;
    if (quotaText && (!Number.isFinite(quotaGb) || quotaGb <= 0)) {
      await edit({ embeds: [errorEmbed("พื้นที่ไม่ถูกต้อง", "ใส่เป็นตัวเลข GB เช่น 1 หรือ 0.5")], components: [row(button("a:new", "ลองอีกครั้ง"), button("a:home", "หน้าแรก"))] });
      return;
    }
    const owner = interaction.fields.getSelectedUsers("owner")?.first();
    try {
      const res = await api(adminId).post("/api/internal/bot/mail/admin/mailboxes", {
        domainId: interaction.fields.getStringSelectValues("domain")[0] || "",
        localPart: interaction.fields.getTextInputValue("local").trim().toLowerCase(),
        ownerDiscordId: owner?.id || "",
        ownerUsername: interaction.fields.getTextInputValue("username").trim(),
        quotaGb,
      });
      const created = res.data as { id: string; address: string; boundDiscord: boolean };
      const lines = [`\`${created.address}\` พร้อมใช้งาน`];
      if (owner && created.boundDiscord) lines.push(`${owner} ยังไม่ได้ล็อกอินเว็บ จึงผูกให้ดูเมลผ่านบอทแทน`);
      else if (owner) lines.push(`เจ้าของคือบัญชีเว็บของ ${owner}`);
      await edit({
        embeds: [new EmbedBuilder().setTitle("สร้างกล่องแล้ว").setColor(COLOR.ok).setDescription(lines.join("\n"))],
        components: [row(button(`a:box:${created.id}`, "จัดการกล่องนี้", ButtonStyle.Primary), button("a:home", "หน้าแรก"))],
      });
    } catch (error) {
      await adminFailure(edit, "admin-create", "สร้างกล่องไม่สำเร็จ", error);
    }
    return;
  }
  if (action === "delsubmit" && MAILBOX_ID_RE.test(parts[2] || "")) {
    const box = parts[2];
    try {
      const res = await api(adminId).delete(`/api/internal/bot/mail/admin/mailboxes/${box}`, {
        data: { confirmAddress: interaction.fields.getTextInputValue("confirm").trim() },
      });
      await renderList(edit, adminId, 0, "", `ลบ \`${res.data.address}\` แล้ว`);
    } catch (error) {
      await adminFailure(edit, "admin-delete", "ลบกล่องไม่สำเร็จ", error, `a:box:${box}`);
    }
    return;
  }
  if (action === "setsubmit") {
    const max = Number.parseInt(interaction.fields.getTextInputValue("max").trim(), 10);
    const quotaGb = Number(interaction.fields.getTextInputValue("quota").trim().replace(",", "."));
    if (!Number.isFinite(max) || !Number.isFinite(quotaGb) || quotaGb <= 0) {
      await edit({ embeds: [errorEmbed("ค่าไม่ถูกต้อง", "จำนวนกล่องและพื้นที่ต้องเป็นตัวเลข")], components: [row(button("a:settings", "แก้อีกครั้ง"), button("a:home", "หน้าแรก"))] });
      return;
    }
    try {
      await api(adminId).put("/api/internal/bot/mail/admin/settings", {
        selfServiceEnabled: interaction.fields.getStringSelectValues("enabled")[0] === "on",
        maxMailboxesPerUser: max,
        quotaBytes: Math.round(quotaGb * 1024 ** 3),
      });
      await renderHome(edit, adminId, "บันทึกการตั้งค่าแล้ว");
    } catch (error) {
      await adminFailure(edit, "admin-settings", "บันทึกไม่สำเร็จ", error);
    }
  }
}
