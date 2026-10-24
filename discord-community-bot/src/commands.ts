import { ApplicationIntegrationType, ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

// /setup, /create and /protect are hidden from members without Manage Server (an admin can open one
// to a role in Server Settings > Integrations). The bot still checks who may run each one, since the
// manager roles set on the web page cannot be expressed with Discord's own command permissions.
// /ticket stays visible: members close their own tickets.
export const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("ตั้งค่าบอท: ห้อง ยศ ฟีเจอร์ที่เปิด และสร้างที่ขาดให้ (ผู้ดูแล)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("create")
    .setNameLocalizations({ th: "สร้าง" })
    .setDescription("สร้างห้อง หมวด หรือยศ (ผู้ดูแล)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub
      .setName("channel")
      .setNameLocalizations({ th: "ห้อง" })
      .setDescription("สร้างห้องข้อความหรือห้องเสียง")
      .addStringOption((option) => option.setName("name").setNameLocalizations({ th: "ชื่อ" }).setDescription("ชื่อห้อง").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("type").setNameLocalizations({ th: "ประเภท" }).setDescription("ห้องแบบไหน").addChoices(
        { name: "ห้องข้อความ", value: "text" },
        { name: "ห้องเสียง", value: "voice" },
        { name: "ห้องประกาศ", value: "announcement" },
      ))
      .addChannelOption((option) => option.setName("category").setNameLocalizations({ th: "หมวด" }).setDescription("อยู่ในหมวดไหน").addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption((option) => option.setName("only").setNameLocalizations({ th: "เห็นเฉพาะยศ" }).setDescription("ให้เห็นเฉพาะยศนี้ (ไม่ใส่ = ตามหมวด)"))
      .addBooleanOption((option) => option.setName("read_only").setNameLocalizations({ th: "อ่านอย่างเดียว" }).setDescription("สมาชิกพิมพ์ไม่ได้ (เช่นห้องประกาศ)"))
      .addStringOption((option) => option.setName("emoji").setDescription("อีโมจิหน้าชื่อ (ไม่ใส่ = ใช้แบบเริ่มต้น)").setMaxLength(16))
      .addBooleanOption((option) => option.setName("plain").setNameLocalizations({ th: "ไม่ตกแต่ง" }).setDescription("ใช้ชื่อตามที่พิมพ์ ไม่ใส่กรอบและอักษรพิเศษ")))
    .addSubcommand((sub) => sub
      .setName("category")
      .setNameLocalizations({ th: "หมวด" })
      .setDescription("สร้างหมวดหมู่")
      .addStringOption((option) => option.setName("name").setNameLocalizations({ th: "ชื่อ" }).setDescription("ชื่อหมวด").setRequired(true).setMaxLength(100))
      .addRoleOption((option) => option.setName("only").setNameLocalizations({ th: "เห็นเฉพาะยศ" }).setDescription("ให้เห็นเฉพาะยศนี้ (ไม่ใส่ = ทุกคน)"))
      .addStringOption((option) => option.setName("emoji").setDescription("อีโมจิหน้าชื่อ (ไม่ใส่ = ใช้แบบเริ่มต้น)").setMaxLength(16))
      .addBooleanOption((option) => option.setName("plain").setNameLocalizations({ th: "ไม่ตกแต่ง" }).setDescription("ใช้ชื่อตามที่พิมพ์ ไม่ใส่กรอบและอักษรพิเศษ")))
    .addSubcommand((sub) => sub
      .setName("role")
      .setNameLocalizations({ th: "ยศ" })
      .setDescription("สร้างยศ")
      .addStringOption((option) => option.setName("name").setNameLocalizations({ th: "ชื่อ" }).setDescription("ชื่อยศ").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("color").setNameLocalizations({ th: "สี" }).setDescription("สีแบบ #2e7eff (ไม่ใส่ก็ได้)").setMaxLength(7))
      .addBooleanOption((option) => option.setName("separate").setNameLocalizations({ th: "แยกกลุ่ม" }).setDescription("แสดงแยกในรายชื่อสมาชิก"))
      .addBooleanOption((option) => option.setName("mentionable").setNameLocalizations({ th: "แท็กได้" }).setDescription("ให้ทุกคนแท็กยศนี้ได้"))
      .addStringOption((option) => option.setName("emoji").setDescription("อีโมจิหน้าชื่อ (ไม่ใส่ = ใช้แบบเริ่มต้น)").setMaxLength(16))
      .addBooleanOption((option) => option.setName("plain").setNameLocalizations({ th: "ไม่ตกแต่ง" }).setDescription("ใช้ชื่อตามที่พิมพ์ ไม่ใส่กรอบและอักษรพิเศษ"))),

  new SlashCommandBuilder()
    .setName("protect")
    .setDescription("ป้องกันเซิร์ฟเวอร์: ใครลบห้องได้ และลบกี่ห้องถึงถูกลงโทษ (ผู้ดูแล)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub
      .setName("status")
      .setNameLocalizations({ th: "ดู" })
      .setDescription("ดูการป้องกันตอนนี้"))
    .addSubcommand((sub) => sub
      .setName("trust")
      .setNameLocalizations({ th: "ให้ลบห้องได้" })
      .setDescription("ให้คนหรือยศนี้ลบห้องได้ ไม่ถูกลงโทษและไม่ถูกสร้างห้องคืน (เจ้าของ/Administrator)")
      .addUserOption((option) => option.setName("member").setNameLocalizations({ th: "สมาชิก" }).setDescription("ใคร"))
      .addRoleOption((option) => option.setName("role").setNameLocalizations({ th: "ยศ" }).setDescription("ทั้งยศ")))
    .addSubcommand((sub) => sub
      .setName("untrust")
      .setNameLocalizations({ th: "เอาออก" })
      .setDescription("เอาคนหรือยศนี้ออกจากรายชื่อที่ลบห้องได้ (เจ้าของ/Administrator)")
      .addUserOption((option) => option.setName("member").setNameLocalizations({ th: "สมาชิก" }).setDescription("ใคร"))
      .addRoleOption((option) => option.setName("role").setNameLocalizations({ th: "ยศ" }).setDescription("ทั้งยศ")))
    .addSubcommand((sub) => sub
      .setName("limit")
      .setNameLocalizations({ th: "จำนวน" })
      .setDescription("ลบกี่ห้องใน 1 นาทีถึงถูกลงโทษ (เจ้าของ/Administrator)")
      .addIntegerOption((option) => option.setName("count").setNameLocalizations({ th: "ห้อง" }).setDescription("1–5 (1 = ห้องแรกก็โดน)").setMinValue(1).setMaxValue(5).setRequired(true))),

  new SlashCommandBuilder()
    .setName("clear")
    .setNameLocalizations({ th: "ลบข้อความ" })
    .setDescription("ลบข้อความในห้องนี้ ห้องที่เลือก หรือทุกห้อง (ทีมงานที่จัดการข้อความได้)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) => option.setName("count").setNameLocalizations({ th: "จำนวน" }).setDescription("ลบกี่ข้อความล่าสุด (ไม่ใส่ = ลบทั้งหมด จะถามยืนยันก่อน)").setMinValue(1).setMaxValue(1000))
    .addChannelOption((option) => option.setName("room").setNameLocalizations({ th: "ห้อง" }).setDescription("ห้องที่จะลบ (ไม่ใส่ = ห้องนี้)")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
    .addUserOption((option) => option.setName("member").setNameLocalizations({ th: "สมาชิก" }).setDescription("ลบเฉพาะข้อความของคนนี้"))
    .addStringOption((option) => option.setName("scope").setNameLocalizations({ th: "ขอบเขต" }).setDescription("ลบทั้งเซิร์ฟเวอร์เลยไหม (ไม่ใส่ = ลบเฉพาะห้องนี้หรือห้องที่เลือก)").addChoices(
      { name: "ทุกห้อง ไม่เว้นเลย (รวมห้อง log, Ticket, ข้อความปักหมุด · เจ้าของ/Administrator)", value: "full" },
      { name: "ทุกห้องข้อความ (ข้ามห้อง log และ Ticket · เจ้าของ/Administrator)", value: "all" },
    )),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("จัดการ Ticket (ใช้ในห้อง Ticket)")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub
      .setName("add")
      .setNameLocalizations({ th: "เพิ่มคน" })
      .setDescription("ให้สมาชิกอีกคนเห็นห้อง Ticket นี้ (ทีมงาน)")
      .addUserOption((option) => option.setName("member").setNameLocalizations({ th: "สมาชิก" }).setDescription("ใคร").setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("remove")
      .setNameLocalizations({ th: "เอาคนออก" })
      .setDescription("เอาสมาชิกออกจากห้อง Ticket นี้ (ทีมงาน)")
      .addUserOption((option) => option.setName("member").setNameLocalizations({ th: "สมาชิก" }).setDescription("ใคร").setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("close")
      .setNameLocalizations({ th: "ปิด" })
      .setDescription("ปิด Ticket นี้")),
];

/** The names above, so the host can tell which module an interaction belongs to. */
export const communityCommandNames = new Set(commands.map((command) => command.name));
