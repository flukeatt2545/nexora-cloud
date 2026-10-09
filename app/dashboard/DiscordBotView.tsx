"use client";

import { DiscordBotConnection } from "./DiscordBotConnection";
import { DiscordMailBotSettings, MailBotSelfServiceSettings } from "./DiscordMailBotSettings";
import { DiscordProtect } from "./DiscordProtect";
import { DiscordVoiceMessages } from "./DiscordVoiceMessages";
import { DiscordVoiceRooms } from "./DiscordVoiceRooms";
import { DiscordVoiceSessions } from "./DiscordVoiceSessions";
import "./hosting-view.css";
import "./discord-mail-bot-settings.css";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

// One group per bot: its connection (token), the status under its name, then its own settings.
export default function DiscordBotView({ notify, isSuperadmin }: { notify: Notice; isSuperadmin: boolean }) {
  return (
    <div className="aov hv">
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">Discord</p>
          <h1>บอท Discord</h1>
          <p className="aov-sub">token สถานะ และการตั้งค่าของบอททั้ง 3 ตัว</p>
        </div>
      </header>

      <section className="dbot-group" aria-label="บอท NEXORA">
        <DiscordBotConnection notify={notify} botKey="nexora" botName="บอท NEXORA" canManage={isSuperadmin}
          description="ฐานข้อมูลนักศึกษา อัปโหลดรูป และคำสั่งในห้อง" />
        <div className="dbot-grid">
          <DiscordMailBotSettings notify={notify} botKey="nexora" title="สถานะใต้ชื่อบอท"
            description="ขึ้นใต้ชื่อบอทในรายชื่อสมาชิก" previewName="NEXORA" defaultText="NEXORA" />
        </div>
      </section>

      <section className="dbot-group" aria-label="บอทเมล">
        <DiscordBotConnection notify={notify} botKey="mail" botName="บอทเมล" canManage={isSuperadmin}
          description="อ่านเมล สร้างเมล และแจ้งเมลใหม่ใน Discord" />
        <div className="dbot-grid">
          <DiscordMailBotSettings notify={notify} botKey="mail" title="สถานะใต้ชื่อบอท"
            description="ขึ้นใต้ชื่อบอทในรายชื่อสมาชิก" previewName="บอทเมล" defaultText="เมลของคุณ" />
          <MailBotSelfServiceSettings notify={notify} />
        </div>
      </section>

      <section className="dbot-group" aria-label="บอทห้องเสียง">
        <DiscordBotConnection notify={notify} botKey="voice" botName="บอทห้องเสียง" canManage={isSuperadmin}
          description="ห้องเสียงแบบ Join to Create ห้องที่ต้องใส่รหัส และประวัติเข้าออก ใช้ได้ทุกเซิร์ฟเวอร์ที่บอทอยู่" />
        <div className="dbot-grid">
          <DiscordMailBotSettings notify={notify} botKey="voice" title="สถานะใต้ชื่อบอท"
            description="ขึ้นใต้ชื่อบอทในรายชื่อสมาชิก" previewName="บอทห้องเสียง" defaultText="ห้องเสียง" />
          {isSuperadmin && <DiscordVoiceRooms notify={notify} />}
          {isSuperadmin && <DiscordProtect notify={notify} />}
          {isSuperadmin && <DiscordVoiceSessions />}
          {isSuperadmin && <DiscordVoiceMessages notify={notify} />}
        </div>
      </section>
    </div>
  );
}
