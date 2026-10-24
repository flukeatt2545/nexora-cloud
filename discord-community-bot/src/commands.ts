import { ApplicationIntegrationType, ChannelType, InteractionContextType, SlashCommandBuilder } from "discord.js";

// Everyone sees these; the bot checks who may run each one (manager roles set on the web page
// cannot be expressed with Discord's own command permissions).
export const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("ตั้งค่าบอท: ห้อง ยศ ฟีเจอร์ที่เปิด และสร้างที่ขาดให้ (ผู้ดูแล)")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("create")
    .setNameLocalizations({ th: "สร้าง" })
    .setDescription("สร้างห้อง หมวด หรือยศ (ผู้ดูแล)")
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
