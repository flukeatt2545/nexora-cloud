import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { crowdSecCommand } from "./features/crowdsec";
import { botControlCommand } from "./features/bot-control";
import { botPanelCommand } from "./features/bot-panel";
import { lockdownCommand } from "./features/lockdown";
import { uploadCommand } from "./features/upload";
import { myUploadsCommand } from "./features/my-uploads";
import { galleryCommand } from "./features/gallery";

export const commands = [
  new SlashCommandBuilder()
    .setName("db")
    .setDescription("เปิดฐานข้อมูลด้วยรหัส 3 ตัวท้าย")
    .addStringOption((option) =>
      option
        .setName("code")
        .setDescription("รหัส 3 ตัวท้าย (เช่น 123)")
        .setRequired(false)
        .setMinLength(2)
        .setMaxLength(10)
    ),

  new SlashCommandBuilder()
    .setName("code")
    .setDescription("เปิดพื้นที่เขียนโค้ดด้วยรหัส 3 ตัวท้าย")
    .addStringOption((option) =>
      option
        .setName("code")
        .setDescription("รหัส 3 ตัวท้าย (เช่น 123)")
        .setRequired(false)
        .setMinLength(2)
        .setMaxLength(10)
    ),

  new SlashCommandBuilder()
    .setName("setup-panel")
    .setDescription("(ผู้ดูแลเท่านั้น) ตั้งปุ่มเข้าใช้งานในห้องนี้")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("admin-map")
    .setDescription("(ผู้ดูแลเท่านั้น) จัดการการผูกรหัส")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("แสดงรายการรหัสและฐานข้อมูลที่ผูกไว้ทั้งหมด")
    )
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("ผูกรหัสกับฐานข้อมูล")
        .addStringOption((opt) =>
          opt
            .setName("code")
            .setDescription("รหัส 3 ตัวท้าย (เช่น 123)")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("database")
            .setDescription("Public ID หรือชื่อฐานข้อมูล (เช่น nxdb_...)")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("ชื่อหรือหมายเหตุ")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("unbind")
        .setDescription("ยกเลิกสิทธิ์ของบัญชีที่ผูกกับรหัสนี้")
        .addStringOption((opt) =>
          opt
            .setName("code")
            .setDescription("รหัส 3 ตัวท้าย (เช่น 123)")
            .setRequired(true)
        )
    ),
  crowdSecCommand,
  botControlCommand,
  botPanelCommand,
  lockdownCommand,
  uploadCommand,
  myUploadsCommand,
  galleryCommand,
];
