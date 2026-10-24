import {
  AttachmentBuilder,
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
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  api,
  apiMessage,
  logBotError,
  type AppPassword,
  type CreateOptions,
  type MailAttachment,
  type Mailbox,
  type MailboxPage,
  type MailMessage,
} from "./api";
import { LOGIN_URL, PUBLIC_APP_URL } from "./config";
import {
  COLOR,
  FOLDERS,
  MAILBOX_ID_RE,
  MESSAGE_ID_RE,
  PUBLIC_ID_RE,
  begin,
  button,
  clip,
  errorEmbed,
  facts,
  formatBytes,
  linkButton,
  plain,
  row,
  stripQuotedReply,
  thaiTime,
  webmailButton,
  type Edit,
  type Interaction,
} from "./ui";

/*
 * Custom IDs (all private to the member who clicked):
 *   m:home                         list of mailboxes
 *   m:pick                         select a mailbox
 *   m:box:<box>:<f>:<page>:<tag>   a folder page; f is i/s/t, tag only keeps IDs unique
 *   m:fold:<box>                   select a folder
 *   m:open:<box>:<f>:<page>        select a message
 *   m:act:<unread|trash|restore>:<box>:<f>:<page>:<msg>
 *   m:notify:<box>:<on|off>:<f>:<page>
 *   m:pw:<box>  m:pwnew:<box>  m:pwrevoke:<box>  m:pwdel:<box>:<cred>
 *   m:new                          create a mailbox (modal m:newsubmit:<update|reply>)
 *   m:dm:open:<box>  m:dm:off:<box>  from a new-mail DM
 * Public panel buttons: mail:inbox, mail:create
 */

type Mode = "update" | "reply";

async function fetchMyMail(discordUserId: string) {
  const res = await api().get(`/api/internal/bot/mail/me/${discordUserId}`);
  return res.data as { linked: boolean; oauth: boolean; mailboxes: Mailbox[]; webmail: string };
}

function failure(edit: Edit, scope: string, title: string, error: unknown, fallback = "ลองใหม่ในอีกสักครู่") {
  logBotError(scope, error);
  return edit({ embeds: [errorEmbed(title, apiMessage(error, fallback))], components: [row(button("m:home", "กล่องเมลของฉัน"))] });
}

// ---------- Home ----------

export async function showHome(interaction: Interaction, mode: Mode, notice = "") {
  const edit = await begin(interaction, mode);
  await renderHome(edit, interaction.user.id, notice);
}

async function renderHome(edit: Edit, discordUserId: string, notice = "") {
  try {
    const data = await fetchMyMail(discordUserId);
    if (!data.mailboxes.length) {
      const embed = new EmbedBuilder()
        .setTitle(data.oauth ? "ยังไม่มีกล่องเมล" : "ยังไม่ได้เชื่อมบัญชี")
        .setColor(COLOR.warn)
        .setDescription(
          data.oauth
            ? "บัญชีของคุณพร้อมแล้ว กด **สร้างเมลใหม่** เพื่อเปิดกล่องแรก"
            : `1. กด **เข้าสู่ระบบ** แล้วเลือกเข้าด้วย Discord\n2. กลับมากด **ตรวจอีกครั้ง**\n\nทำครั้งเดียว ครั้งต่อไปใช้ได้เลย`
        );
      const buttons = data.oauth
        ? [button("m:new", "สร้างเมลใหม่", ButtonStyle.Primary)]
        : [linkButton("เข้าสู่ระบบ", LOGIN_URL), button("m:home", "ตรวจอีกครั้ง")];
      await edit({ content: notice, embeds: [embed], components: [row(...buttons)] });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle("เมลของฉัน")
      .setColor(COLOR.brand)
      .setDescription(
        `${data.mailboxes.map((box) => `**${box.address}**${box.displayName ? `\n${plain(box.displayName)}` : ""}`).join("\n\n")}`
      )
      .setFooter({ text: `${data.mailboxes.length} กล่อง · เลือกกล่องจากเมนูด้านล่างเพื่ออ่านเมล` });
    const select = new StringSelectMenuBuilder()
      .setCustomId("m:pick")
      .setPlaceholder("เปิดกล่องเมล")
      .addOptions(
        data.mailboxes.slice(0, 25).map((box) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(clip(box.address, 100))
            .setValue(box.id)
            .setDescription(clip(box.displayName || "เปิดกล่องเข้า", 100))
        )
      );
    const components = [row(select)];
    if (data.oauth) components.push(row(button("m:new", "สร้างเมลใหม่")));
    await edit({ content: notice, embeds: [embed], components });
  } catch (error) {
    logBotError("home", error);
    await edit({
      embeds: [errorEmbed("เปิดเมลไม่สำเร็จ", apiMessage(error, "ลองใหม่ในอีกสักครู่"))],
      components: [row(button("m:home", "ลองอีกครั้ง"))],
    });
  }
}

// ---------- Folder page ----------

async function renderBox(edit: Edit, discordUserId: string, box: string, f: string, page: number, notice = "") {
  const folder = FOLDERS[f] || FOLDERS.i;
  const code = FOLDERS[f] ? f : "i";
  let data: MailboxPage;
  try {
    const res = await api().get("/api/internal/bot/mail/messages", {
      params: { discordUserId, mailboxId: box, folder: folder.key, page },
    });
    data = res.data as MailboxPage;
  } catch (error) {
    await failure(edit, "box", "เปิดกล่องไม่สำเร็จ", error);
    return;
  }
  const lines = data.items.map((item, index) => {
    const number = page * 10 + index + 1;
    const subject = plain(clip(item.subject || "ไม่มีหัวข้อ", 80));
    const who = plain(clip(item.fromName || item.from || "ไม่ทราบผู้ส่ง", 60));
    const attachmentTag = item.hasAttachment ? "  `ไฟล์แนบ`" : "";
    const title = (item.read ? `${number}. ${subject}` : `**${number}. ${subject}**  \`ใหม่\``) + attachmentTag;
    return `${title}\n${code === "s" ? "ถึง " : ""}${who} · ${thaiTime(item.date, "short")}`;
  });
  const empty = page > 0 ? "ไม่มีเมลในหน้านี้แล้ว" : code === "i" ? "ยังไม่มีเมลเข้า" : `${folder.label}ว่าง`;
  const embed = new EmbedBuilder()
    .setAuthor({ name: data.address })
    .setTitle(folder.label)
    .setColor(COLOR.brand)
    .setDescription(lines.length ? lines.join("\n\n") : empty)
    .setFooter({ text: `หน้า ${page + 1} · แจ้งเตือนทาง DM ${data.notify ? "เปิดอยู่" : "ปิดอยู่"}` });

  const folderSelect = new StringSelectMenuBuilder()
    .setCustomId(`m:fold:${box}`)
    .addOptions(
      Object.entries(FOLDERS).map(([key, value]) =>
        new StringSelectMenuOptionBuilder().setLabel(value.label).setValue(key).setDefault(key === code)
      )
    );
  const components = [row(folderSelect)];
  const messageOptions = data.items
    .map((item, index) => ({ item, number: page * 10 + index + 1 }))
    .filter(({ item }) => MESSAGE_ID_RE.test(item.id))
    .map(({ item, number }) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(clip(`${number}. ${item.subject || "ไม่มีหัวข้อ"}`, 100))
        .setDescription(clip(item.fromName || item.from || "ไม่ทราบผู้ส่ง", 100))
        .setValue(item.id)
    );
  if (messageOptions.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`m:open:${box}:${code}:${page}`)
          .setPlaceholder("เปิดอ่านเมล")
          .addOptions(messageOptions)
      )
    );
  }
  components.push(
    row(
      button(`m:box:${box}:${code}:${Math.max(page - 1, 0)}:p`, "ก่อนหน้า", ButtonStyle.Secondary, page === 0),
      button(`m:box:${box}:${code}:${page + 1}:n`, "ถัดไป", ButtonStyle.Secondary, !data.hasMore),
      button(`m:box:${box}:${code}:${page}:r`, "รีเฟรช")
    )
  );
  const actions = [
    data.notify
      ? button(`m:notify:${box}:off:${code}:${page}`, "ปิดแจ้งเตือน")
      : button(`m:notify:${box}:on:${code}:${page}`, "แจ้งเตือนทาง DM", ButtonStyle.Primary),
  ];
  if (data.canAppPasswords) actions.push(button(`m:pw:${box}`, "รหัสผ่านแอป"));
  actions.push(button("m:home", "กล่องอื่น"));
  components.push(row(...actions));
  await edit({ content: notice, embeds: [embed], components });
}

// ---------- One message ----------

async function renderMessage(edit: Edit, discordUserId: string, box: string, f: string, page: number, messageId: string) {
  let item: MailMessage;
  try {
    const res = await api().get(`/api/internal/bot/mail/messages/${encodeURIComponent(messageId)}`, {
      params: { discordUserId, mailboxId: box, markRead: true },
    });
    item = res.data as MailMessage;
  } catch (error) {
    await failure(edit, "message", "เปิดเมลไม่สำเร็จ", error);
    return;
  }
  const from = item.fromName ? `${plain(item.fromName)} <${item.from}>` : item.from || "-";
  const header = facts([
    ["จาก", clip(from, 200)],
    ["เมื่อ", thaiTime(item.date)],
  ]);
  const { files, others } = await loadImages(discordUserId, box, item.attachments || []);
  const reply = stripQuotedReply(item.text || "");
  const fallback = files.length ? "" : "เมลนี้ไม่มีข้อความ เปิดอ่านใน Webmail";
  const body = plain(reply.text || fallback) + (reply.hidden ? "\n\n*ซ่อนข้อความเดิมที่ตอบกลับไว้*" : "");
  const fileList = others.length
    ? `\n\n**ไฟล์แนบ**\n${others.map((file) => `• ${plain(clip(file.name, 80))} · ${formatBytes(file.size)}`).join("\n")}`
    : "";
  const embed = new EmbedBuilder()
    .setAuthor({ name: item.address })
    .setTitle(clip(item.subject || "ไม่มีหัวข้อ", 256))
    .setURL(item.webmail)
    .setColor(COLOR.brand)
    .setDescription(`${header}\n\n${body}`.trim().slice(0, 3800) + fileList.slice(0, 190))
    .setFooter({ text: messageFooter(files.length, others.length) });
  // Embeds that share the first one's URL are shown together as one gallery.
  const embeds = [embed];
  files.forEach((file, index) => {
    const target = index === 0 ? embed : new EmbedBuilder().setURL(item.webmail);
    target.setImage(`attachment://${file.name}`);
    if (index > 0) embeds.push(target);
  });
  const back = button(`m:box:${box}:${f}:${page}:b`, "กลับ");
  const buttons = [back];
  if (item.canManage) {
    const tail = `${box}:${f}:${page}:${item.id}`;
    buttons.push(button(`m:act:unread:${tail}`, "ยังไม่อ่าน"));
    if (item.folder === "trash") buttons.push(button(`m:act:restore:${tail}`, "ย้ายกลับกล่องเข้า"));
    else buttons.push(button(`m:act:trash:${tail}`, "ลงถังขยะ", ButtonStyle.Danger));
  }
  buttons.push(webmailButton());
  await edit({ embeds, components: [row(...buttons)], files });
}

function messageFooter(images: number, otherFiles: number) {
  const parts = [];
  if (images) parts.push(`รูป ${images} รูป`);
  if (otherFiles) parts.push(`ไฟล์แนบ ${otherFiles} ไฟล์ เปิดใน Webmail`);
  return parts.length ? parts.join(" · ") : "อ่านฉบับเต็มได้ใน Webmail";
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Discord's upload limit for one message is 10 MB; stay under it.
const MAX_TOTAL_IMAGE_BYTES = 9 * 1024 * 1024;

/**
 * Downloads up to four images to show with the message. Anything that is not an image, too
 * big, or fails to load is returned in `others` so it is listed as an attachment instead.
 */
async function loadImages(discordUserId: string, box: string, attachments: MailAttachment[]) {
  const files: AttachmentBuilder[] = [];
  const others: MailAttachment[] = [];
  let total = 0;
  for (const attachment of attachments) {
    const ext = IMAGE_TYPES[attachment.type];
    const fits = attachment.size <= MAX_IMAGE_BYTES && total + attachment.size <= MAX_TOTAL_IMAGE_BYTES;
    if (!ext || !fits || files.length >= MAX_IMAGES) {
      others.push(attachment);
      continue;
    }
    try {
      const res = await api().get("/api/internal/bot/mail/image", {
        params: { discordUserId, mailboxId: box, blobId: attachment.blobId },
        responseType: "arraybuffer",
        timeout: 20000,
      });
      const data = Buffer.from(res.data as ArrayBuffer);
      const realExt = IMAGE_TYPES[String(res.headers["content-type"] || "").split(";")[0].trim()] || ext;
      total += data.length;
      files.push(new AttachmentBuilder(data, { name: `image-${files.length + 1}.${realExt}` }));
    } catch (error) {
      logBotError("mail-image", error);
      others.push(attachment);
    }
  }
  return { files, others };
}

// ---------- App passwords ----------

async function renderAppPasswords(edit: Edit, discordUserId: string, box: string, notice = "") {
  let data: { address: string; items: AppPassword[]; max: number };
  try {
    const res = await api(discordUserId).get(`/api/internal/bot/mail/mailboxes/${box}/app-passwords`);
    data = res.data;
  } catch (error) {
    await failure(edit, "app-passwords", "เปิดรหัสผ่านแอปไม่สำเร็จ", error);
    return;
  }
  const list = data.items.length
    ? data.items.map((item) => `**${plain(item.description || "ไม่มีชื่อ")}**\nสร้างเมื่อ ${thaiTime(item.createdAt, "short")}`).join("\n\n")
    : "ยังไม่มีรหัสผ่านแอป";
  const embed = new EmbedBuilder()
    .setAuthor({ name: data.address })
    .setTitle("รหัสผ่านแอป")
    .setColor(COLOR.brand)
    .setDescription(
      `ใช้เข้าเมลกล่องนี้จากแอปในมือถือหรือคอม เช่น Mail ของ iPhone, Outlook, Thunderbird รหัสจะแสดงครั้งเดียวตอนสร้าง\n\n${list}`
    )
    .setFooter({ text: `ใช้ไป ${data.items.length}/${data.max} อัน` });
  const components = [];
  if (data.items.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`m:pwrevoke:${box}`)
          .setPlaceholder("เลือกรหัสที่จะยกเลิก")
          .addOptions(
            data.items.slice(0, 25).map((item) =>
              new StringSelectMenuOptionBuilder().setLabel(clip(item.description || "ไม่มีชื่อ", 100)).setValue(item.id)
            )
          )
      )
    );
  }
  components.push(
    row(
      button(`m:pwnew:${box}`, "สร้างรหัสใหม่", ButtonStyle.Primary, data.items.length >= data.max),
      button(`m:box:${box}:i:0:b`, "กลับ")
    )
  );
  await edit({ content: notice, embeds: [embed], components });
}

// ---------- Create a mailbox ----------

async function openCreateModal(interaction: ButtonInteraction, mode: Mode) {
  let options: CreateOptions;
  try {
    const res = await api(interaction.user.id).get("/api/internal/bot/mail/create-options", { timeout: 2500 });
    options = res.data as CreateOptions;
  } catch (error) {
    logBotError("create-options", error);
    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [errorEmbed("เปิดหน้าสร้างเมลไม่สำเร็จ", "ลองใหม่ในอีกสักครู่")] });
    return;
  }
  if (!options.linked) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [errorEmbed("ยังไม่ได้เชื่อมบัญชี", `ล็อกอินเว็บ ${PUBLIC_APP_URL} ด้วย Discord ก่อน แล้วกลับมาสร้างเมลอีกครั้ง`)],
      components: [row(linkButton("เข้าสู่ระบบ", LOGIN_URL))],
    });
    return;
  }
  const limitReached = (options.used ?? 0) >= (options.limit ?? 0);
  const domains = options.domains.filter((domain) => !domain.shared || !limitReached);
  if (!domains.length) {
    const reason = !options.enabled
      ? "ตอนนี้ปิดการสร้างเมลผ่านบอทอยู่ ติดต่อผู้ดูแลระบบ"
      : limitReached
        ? `คุณสร้างครบ ${options.limit} กล่องแล้ว ติดต่อผู้ดูแลถ้าต้องการเพิ่ม`
        : "ยังไม่มีโดเมนที่เปิดให้สร้างเมล";
    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [errorEmbed("สร้างเมลไม่ได้", reason)] });
    return;
  }
  const info = options.domains.some((domain) => domain.shared)
    ? `โดเมนกลางใช้ไป ${options.used}/${options.limit} กล่อง · พื้นที่กล่องละ ${formatBytes(options.quotaBytes ?? 0)}`
    : "สร้างบนโดเมนของคุณเอง";
  const modal = new ModalBuilder()
    .setCustomId(`m:newsubmit:${mode}`)
    .setTitle("สร้างเมลใหม่")
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(info))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("โดเมน")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("domain")
            .addOptions(
              domains.map((domain, index) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(`@${domain.domain}`)
                  .setValue(domain.id)
                  .setDescription(domain.shared ? "โดเมนกลาง" : "โดเมนของคุณ")
                  .setDefault(index === 0)
              )
            )
        ),
      new LabelBuilder()
        .setLabel("ชื่ออีเมล (ส่วนหน้า @)")
        .setDescription("a-z 0-9 . _ - เช่น somchai หรือ shop.sales")
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("local").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(64).setPlaceholder("somchai")
        ),
      new LabelBuilder()
        .setLabel("ชื่อที่แสดง")
        .setDescription("ไม่บังคับ ผู้รับจะเห็นชื่อนี้")
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("name").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)
        )
    );
  await interaction.showModal(modal);
}

async function submitCreate(interaction: ModalSubmitInteraction, mode: Mode) {
  const edit = await begin(interaction, mode);
  const domainId = interaction.fields.getStringSelectValues("domain")[0] || "";
  const localPart = interaction.fields.getTextInputValue("local").trim().toLowerCase();
  const displayName = interaction.fields.getTextInputValue("name").trim();
  try {
    const res = await api(interaction.user.id).post("/api/internal/bot/mail/mailboxes", { domainId, localPart, displayName });
    const created = res.data as { id: string; address: string; provisionState: string };
    const embed = new EmbedBuilder()
      .setTitle("สร้างเมลแล้ว")
      .setColor(COLOR.ok)
      .setDescription(
        [
          `**${created.address}** พร้อมรับส่งเมลแล้ว`,
          ...(created.provisionState === "failed" ? ["> เซิร์ฟเวอร์เมลยังตั้งค่าไม่เสร็จ ระบบจะลองใหม่ให้อัตโนมัติ"] : []),
          "",
          "ขั้นต่อไปที่แนะนำ",
          "• เปิด **แจ้งเตือนทาง DM** เพื่อรู้ทันทีเมื่อมีเมลเข้า",
          "• สร้าง **รหัสผ่านแอป** ถ้าจะใช้กับแอปเมลในมือถือ",
        ].join("\n")
      );
    await edit({
      embeds: [embed],
      components: [
        row(
          button(`m:box:${created.id}:i:0:o`, "เปิดกล่องนี้", ButtonStyle.Primary),
          button(`m:notify:${created.id}:on:i:0`, "แจ้งเตือนทาง DM"),
          button(`m:pw:${created.id}`, "รหัสผ่านแอป")
        ),
      ],
    });
  } catch (error) {
    logBotError("create-mailbox", error);
    await edit({
      embeds: [errorEmbed("สร้างเมลไม่สำเร็จ", apiMessage(error, "ลองใหม่ในอีกสักครู่"))],
      components: [row(button("m:new", "ลองอีกครั้ง", ButtonStyle.Primary), button("m:home", "กล่องเมลของฉัน"))],
    });
  }
}

// ---------- Routing ----------

function parsePage(value: string | undefined) {
  const page = Number.parseInt(value || "0", 10);
  return Number.isFinite(page) && page >= 0 && page <= 200 ? page : 0;
}

function validBox(box: string | undefined): box is string {
  return Boolean(box && MAILBOX_ID_RE.test(box));
}

/** Buttons on the public panel posted by /setup-mail-panel. */
export async function handlePanelButton(interaction: ButtonInteraction) {
  if (interaction.customId === "mail:create") {
    await openCreateModal(interaction, "reply");
    return;
  }
  await showHome(interaction, "reply");
}

export async function handleUserComponent(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const userId = interaction.user.id;

  if (action === "new" && interaction.isButton()) {
    await openCreateModal(interaction, "update");
    return;
  }
  if (action === "pwnew" && interaction.isButton()) {
    const box = parts[2];
    if (!validBox(box)) return;
    const modal = new ModalBuilder()
      .setCustomId(`m:pwsubmit:${box}`)
      .setTitle("สร้างรหัสผ่านแอป")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("ใช้กับอุปกรณ์อะไร")
          .setDescription("ตั้งชื่อไว้จำ เช่น iPhone ของฉัน หรือ Outlook ที่ทำงาน")
          .setTextInputComponent(
            new TextInputBuilder().setCustomId("desc").setStyle(TextInputStyle.Short).setMaxLength(60).setPlaceholder("iPhone ของฉัน")
          )
      );
    await interaction.showModal(modal);
    return;
  }

  // DM buttons answer with a new private message so the notification stays in the DM.
  const mode: Mode = action === "dm" ? "reply" : "update";
  const edit = await begin(interaction, mode);

  switch (action) {
    case "home":
      await renderHome(edit, userId);
      return;
    case "pick":
      if (interaction.isStringSelectMenu() && validBox(interaction.values[0])) {
        await renderBox(edit, userId, interaction.values[0], "i", 0);
      }
      return;
    case "box":
      if (validBox(parts[2])) await renderBox(edit, userId, parts[2], parts[3], parsePage(parts[4]));
      return;
    case "fold":
      if (interaction.isStringSelectMenu() && validBox(parts[2])) await renderBox(edit, userId, parts[2], interaction.values[0], 0);
      return;
    case "open":
      if (interaction.isStringSelectMenu() && validBox(parts[2]) && MESSAGE_ID_RE.test(interaction.values[0] || "")) {
        await renderMessage(edit, userId, parts[2], parts[3], parsePage(parts[4]), interaction.values[0]);
      }
      return;
    case "act": {
      const [, , kind, box, f, page] = parts;
      const messageId = parts.slice(6).join(":");
      if (!validBox(box) || !MESSAGE_ID_RE.test(messageId)) return;
      const body = kind === "unread" ? { read: false } : { folder: kind === "restore" ? "inbox" : "trash" };
      try {
        await api(userId).patch(`/api/internal/bot/mail/messages/${encodeURIComponent(messageId)}`, { mailboxId: box, ...body });
      } catch (error) {
        await failure(edit, "message-action", "ทำรายการไม่สำเร็จ", error);
        return;
      }
      const notice = kind === "unread" ? "ทำเป็นยังไม่อ่านแล้ว" : kind === "restore" ? "ย้ายกลับกล่องเข้าแล้ว" : "ย้ายลงถังขยะแล้ว";
      await renderBox(edit, userId, box, f, parsePage(page), notice);
      return;
    }
    case "notify": {
      const [, , box, state, f, page] = parts;
      if (!validBox(box)) return;
      try {
        await api(userId).put("/api/internal/bot/mail/notify", { mailboxId: box, enabled: state === "on" });
      } catch (error) {
        await failure(edit, "notify", "ตั้งค่าแจ้งเตือนไม่สำเร็จ", error);
        return;
      }
      const notice =
        state === "on" ? "เปิดแจ้งเตือนแล้ว เมลใหม่ของกล่องนี้จะส่งเข้า DM ของคุณ (ต้องเปิดรับข้อความส่วนตัวจากสมาชิกเซิร์ฟเวอร์ไว้)" : "ปิดแจ้งเตือนแล้ว";
      await renderBox(edit, userId, box, f, parsePage(page), notice);
      return;
    }
    case "pw":
      if (validBox(parts[2])) await renderAppPasswords(edit, userId, parts[2]);
      return;
    case "pwrevoke": {
      const box = parts[2];
      const credential = interaction.isStringSelectMenu() ? interaction.values[0] : "";
      if (!validBox(box) || !PUBLIC_ID_RE.test(credential || "")) return;
      await edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("ยกเลิกรหัสผ่านแอปนี้?")
            .setColor(COLOR.warn)
            .setDescription("แอปที่ใช้รหัสนี้จะรับส่งเมลไม่ได้ทันที ต้องสร้างรหัสใหม่ไปใส่แทน"),
        ],
        components: [row(button(`m:pwdel:${box}:${credential}`, "ยกเลิกรหัสนี้", ButtonStyle.Danger), button(`m:pw:${box}`, "ไม่ยกเลิก"))],
      });
      return;
    }
    case "pwdel": {
      const [, , box, credential] = parts;
      if (!validBox(box) || !PUBLIC_ID_RE.test(credential || "")) return;
      try {
        await api(userId).delete(`/api/internal/bot/mail/mailboxes/${box}/app-passwords/${credential}`);
      } catch (error) {
        await failure(edit, "app-password-revoke", "ยกเลิกรหัสไม่สำเร็จ", error);
        return;
      }
      await renderAppPasswords(edit, userId, box, "ยกเลิกรหัสแล้ว");
      return;
    }
    case "dm": {
      const [, , kind, box] = parts;
      if (!validBox(box)) return;
      if (kind === "off") {
        try {
          await api(userId).put("/api/internal/bot/mail/notify", { mailboxId: box, enabled: false });
          await edit({ content: "ปิดแจ้งเตือนของกล่องนี้แล้ว เปิดใหม่ได้จากปุ่มในกล่องเมล" });
        } catch (error) {
          await failure(edit, "notify-off", "ปิดแจ้งเตือนไม่สำเร็จ", error);
        }
        return;
      }
      if (interaction.isStringSelectMenu() && MESSAGE_ID_RE.test(interaction.values[0] || "")) {
        await renderMessage(edit, userId, box, "i", 0, interaction.values[0]);
      } else {
        await renderBox(edit, userId, box, "i", 0);
      }
      return;
    }
    default:
      await edit({ content: "เมนูนี้หมดอายุแล้ว พิมพ์ /mail เพื่อเปิดใหม่" });
  }
}

export async function handleUserModal(interaction: ModalSubmitInteraction) {
  const parts = interaction.customId.split(":");
  if (parts[1] === "newsubmit") {
    await submitCreate(interaction, parts[2] === "reply" ? "reply" : "update");
    return;
  }
  if (parts[1] === "pwsubmit" && validBox(parts[2])) {
    const box = parts[2];
    const edit = await begin(interaction, "update");
    try {
      const res = await api(interaction.user.id).post(`/api/internal/bot/mail/mailboxes/${box}/app-passwords`, {
        description: interaction.fields.getTextInputValue("desc"),
      });
      const created = res.data as { address: string; password: string; host: string; imapPort: number; smtpPort: number };
      const embed = new EmbedBuilder()
        .setAuthor({ name: created.address })
        .setTitle("รหัสผ่านแอปใหม่")
        .setColor(COLOR.ok)
        .setDescription(
          [
            "คัดลอกไปใส่ในแอปเมลตอนนี้ เมื่อกด **เสร็จแล้ว** จะดูรหัสนี้ซ้ำไม่ได้",
            "",
            "**รหัสผ่าน**",
            `\`\`\`${created.password}\`\`\``,
            facts([
              ["ชื่อผู้ใช้", created.address],
              ["รับเมล (IMAP)", `${created.host} · ${created.imapPort} · SSL/TLS`],
              ["ส่งเมล (SMTP)", `${created.host} · ${created.smtpPort} · SSL/TLS`],
            ]),
          ].join("\n")
        );
      await edit({ embeds: [embed], components: [row(button(`m:pw:${box}`, "เสร็จแล้ว"))] });
    } catch (error) {
      await failure(edit, "app-password-create", "สร้างรหัสไม่สำเร็จ", error);
    }
  }
}

export function userPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle("อีเมล NEXORA")
    .setColor(COLOR.brand)
    .setDescription(
      [
        "อ่านเมล สร้างอีเมลของตัวเอง และรับแจ้งเตือนเมลใหม่ทาง DM ได้จากที่นี่",
        "",
        "กด **เมลของฉัน** แล้วบอทจะพาไปต่อเอง ถ้ายังไม่ได้เชื่อมบัญชี จะมีปุ่มให้เข้าสู่ระบบด้วย Discord ก่อน",
      ].join("\n")
    )
    .setFooter({ text: "หน้าต่างที่เปิดจากปุ่มเห็นเฉพาะคนที่กด" });
  // One button for everyone: the private window decides what to offer. A shared message
  // cannot show different buttons to different people.
  return {
    embeds: [embed],
    components: [row(button("mail:inbox", "เมลของฉัน", ButtonStyle.Primary))],
  };
}
