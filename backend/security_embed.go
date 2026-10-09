package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Embeds for the security webhook ("NEXORA Security"). Each event is a title, one sentence
// saying who did what to whom, and only the fields that add something to that sentence.

const (
	securityColorOK      = 0x22C55E
	securityColorInfo    = 0x3B82F6
	securityColorNeutral = 0x6B7280
	securityColorWarn    = 0xF59E0B
	securityColorDanger  = 0xEF4444
	securityColorThreat  = 0xB91C1C
	securityColorContent = 0x8B5CF6
)

// securityCopy holds the title and sentence for one action. {actor}, {target} and {provider}
// are filled in by buildDiscordEmbed with text that is already escaped.
type securityCopy struct {
	Title string
	Text  string
	Color int
}

var securityCopies = map[string]securityCopy{
	"auth.login":                   {"เข้าสู่ระบบ", "{actor} เข้าสู่ระบบด้วยรหัสผ่าน", securityColorOK},
	"auth.oauth":                   {"เข้าสู่ระบบด้วย {provider}", "{actor} เข้าสู่ระบบด้วยบัญชี {provider}", securityColorOK},
	"auth.register":                {"สมัครสมาชิกใหม่", "{actor} สมัครสมาชิกและเข้าสู่ระบบแล้ว", securityColorOK},
	"auth.logout":                  {"ออกจากระบบ", "{actor} ออกจากระบบ", securityColorNeutral},
	"password.changed":             {"เปลี่ยนรหัสผ่าน", "{actor} เปลี่ยนรหัสผ่านของตัวเอง", securityColorWarn},
	"social.connected":             {"เชื่อมบัญชี {provider}", "{actor} เชื่อมบัญชี {provider} เข้ากับบัญชี NEXORA", securityColorInfo},
	"session.revoked":              {"ยกเลิกเซสชัน", "{actor} สั่งออกจากระบบบนอุปกรณ์หนึ่งเครื่อง", securityColorWarn},
	"sessions.revoked_for_user":    {"บังคับออกจากระบบ", "{actor} บังคับ {target} ออกจากระบบทุกอุปกรณ์", securityColorWarn},
	"sessions.revoked_all":         {"บังคับทุกคนออกจากระบบ", "{actor} บังคับผู้ใช้ทุกคนออกจากระบบทุกอุปกรณ์", securityColorDanger},
	"user.created":                 {"สร้างบัญชีผู้ใช้", "{actor} สร้างบัญชี {target}", securityColorOK},
	"user.updated":                 {"แก้ไขข้อมูลผู้ใช้", "{actor} แก้ไขข้อมูลบัญชี {target}", securityColorInfo},
	"user.deleted":                 {"ลบบัญชีผู้ใช้", "{actor} ลบบัญชี {target} ออกจากระบบถาวร", securityColorDanger},
	"user.status_changed":          {"เปลี่ยนสถานะบัญชี", "{actor} เปลี่ยนสถานะบัญชี {target}", securityColorWarn},
	"user.role_changed":            {"เปลี่ยนระดับสิทธิ์", "{actor} เปลี่ยนระดับสิทธิ์ของ {target}", securityColorWarn},
	"user.password_reset":          {"รีเซ็ตรหัสผ่านผู้ใช้", "{actor} ตั้งรหัสผ่านใหม่ให้ {target}", securityColorWarn},
	"settings.updated":             {"แก้ไขการตั้งค่าระบบ", "{actor} บันทึกการตั้งค่าระบบหลัก", securityColorInfo},
	"topup.settings_updated":       {"แก้ไขระบบเติมเงิน", "{actor} แก้ไขการตั้งค่าระบบเติมเงิน", securityColorInfo},
	"webhook.tested":               {"ทดสอบการแจ้งเตือน", "{actor} กดทดสอบ ข้อความนี้มาถึงแปลว่าเว็บฮุกใช้งานได้", securityColorOK},
	"announcement.created":         {"สร้างประกาศ", "{actor} สร้างประกาศ {target}", securityColorContent},
	"announcement.updated":         {"แก้ไขประกาศ", "{actor} แก้ไขประกาศ {target}", securityColorContent},
	"announcement.deleted":         {"ลบประกาศ", "{actor} ลบประกาศ {target}", securityColorDanger},
	"hosting.site.created":         {"สร้างเว็บไซต์โฮสติ้ง", "{actor} สร้างเว็บไซต์ {target}", securityColorOK},
	"hosting.site.updated":         {"แก้ไขเว็บไซต์โฮสติ้ง", "{actor} แก้ไขการตั้งค่าเว็บไซต์ {target}", securityColorInfo},
	"hosting.site.deleted":         {"ลบเว็บไซต์โฮสติ้ง", "{actor} ลบเว็บไซต์ {target}", securityColorDanger},
	"hosting.database.created":     {"สร้างฐานข้อมูล MySQL", "{actor} สร้างฐานข้อมูล {target}", securityColorOK},
	"hosting.database.deleted":     {"ลบฐานข้อมูล MySQL", "{actor} ลบฐานข้อมูล {target}", securityColorDanger},
	"hosting.database.suspended":   {"ระงับฐานข้อมูล MySQL", "{actor} ระงับฐานข้อมูล {target} เว็บที่ใช้ฐานนี้จะเชื่อมต่อไม่ได้จนกว่าจะปลดระงับ", securityColorDanger},
	"hosting.database.unsuspended": {"ปลดระงับฐานข้อมูล MySQL", "{actor} ปลดระงับฐานข้อมูล {target} เว็บกลับมาเชื่อมต่อได้ตามปกติ", securityColorInfo},
	"ip.banned":                    {"แบน IP", "{actor} แบน IP {target}", securityColorDanger},
	"ip.unbanned":                  {"ปลดแบน IP", "{actor} ปลดแบน IP {target}", securityColorInfo},
	"ip.banned_access":             {"🚫 IP ที่ถูกแบนพยายามเข้าเว็บ", "ระบบปฏิเสธคำขอจาก IP {target} ที่อยู่ในรายการแบน (แจ้งซ้ำไม่เกินทุก 10 นาทีต่อ IP)", securityColorThreat},
	"lockdown.enabled":             {"🔒 ล็อกเว็บไซต์", "{actor} ล็อกเว็บไซต์ ผู้ใช้ทั่วไปจะเข้าไม่ได้จนกว่าจะปลดล็อก", securityColorDanger},
	"lockdown.disabled":            {"🔓 ปลดล็อกเว็บไซต์", "{actor} ปลดล็อกเว็บไซต์ ทุกคนกลับมาใช้งานได้ตามปกติ", securityColorOK},
	"lockdown.state_read_failed":   {"อ่านสถานะล็อกเว็บไซต์ไม่ได้", "ระบบใช้สถานะล่าสุดที่เชื่อถือได้ไปก่อน ควรตรวจ PostgreSQL และ Redis", securityColorDanger},
	"workspace.security_alert":     {"🛡️ เว็บโฮสติ้งบล็อกคำขอน่าสงสัย", "ระบบป้องกันของเว็บไซต์ {target} บล็อกคำขอที่น่าสงสัย", securityColorThreat},
	"discord.voice.locked_out":     {"ใส่รหัสห้องเสียงผิดจนถูกห้าม", "{actor} ใส่รหัสห้อง {target} ผิดครบกำหนด ถูกห้ามลองห้องนี้ชั่วคราว", securityColorWarn},
	"discord.voice.entry_denied":   {"บอทเตะคนที่ไม่มีรหัสห้อง", "บอทให้สมาชิกออกจากห้อง {target} เพราะเข้ามาโดยไม่ได้ใส่รหัส", securityColorWarn},
	"discord.bot_token.updated":    {"เปลี่ยน token บอท Discord", "{actor} ใส่ token ใหม่ให้{target} บอทจะล็อกอินใหม่เอง", securityColorWarn},
	"discord.bot_token.removed":    {"ลบ token บอท Discord", "{actor} ลบ token ของ{target} บอทจะออฟไลน์", securityColorDanger},
}

var securityAlertActions = map[string]bool{"ip.banned_access": true, "workspace.security_alert": true, "lockdown.state_read_failed": true,
	"discord.voice.locked_out": true, "discord.voice.entry_denied": true}

var oauthProviderNames = map[string]string{"discord": "Discord", "google": "Google", "github": "GitHub"}

var thaiShortMonths = []string{"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."}

var bangkokZone = time.FixedZone("ICT", 7*3600)

// thaiDateTime formats a time as "8 ต.ค. 2569 เวลา 02:14:29 น." in Bangkok time.
func thaiDateTime(t time.Time) string {
	t = t.In(bangkokZone)
	return fmt.Sprintf("%d %s %d เวลา %02d:%02d:%02d น.", t.Day(), thaiShortMonths[t.Month()-1], t.Year()+543, t.Hour(), t.Minute(), t.Second())
}

func securityFooter(source string) fiber.Map {
	text := "NEXORA Security · " + thaiDateTime(time.Now())
	if source != "" {
		text = "NEXORA Security · " + source + " · " + thaiDateTime(time.Now())
	}
	return fiber.Map{"text": text}
}

func parseUserAgent(ua string) string {
	if ua == "" {
		return "—"
	}
	browser := "เบราว์เซอร์"
	switch {
	case strings.Contains(ua, "PostmanRuntime"):
		browser = "Postman"
	case strings.Contains(ua, "Edg/") || strings.Contains(ua, "EdgiOS/") || strings.Contains(ua, "EdgA/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/") || strings.Contains(ua, "OPiOS/"):
		browser = "Opera"
	case strings.Contains(ua, "SamsungBrowser/"):
		browser = "Samsung Internet"
	case strings.Contains(ua, "Firefox/") || strings.Contains(ua, "FxiOS/"):
		browser = "Firefox"
	case strings.Contains(ua, "CriOS/") || (strings.Contains(ua, "Chrome/") && !strings.Contains(ua, "Chromium/")):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}

	// iPhone and iPad user agents also say "like Mac OS X", and Android ones say "Linux",
	// so the mobile systems are checked first.
	system := "อุปกรณ์ไม่ทราบชนิด"
	switch {
	case strings.Contains(ua, "iPhone"):
		system = "iPhone"
	case strings.Contains(ua, "iPad"):
		system = "iPad"
	case strings.Contains(ua, "Android"):
		system = "Android"
	case strings.Contains(ua, "Windows"):
		system = "Windows"
	case strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X"):
		system = "macOS"
	case strings.Contains(ua, "CrOS"):
		system = "ChromeOS"
	case strings.Contains(ua, "Linux"):
		system = "Linux"
	}
	return browser + " บน " + system
}

func formatRoleThai(role string) string {
	switch role {
	case "superadmin":
		return "ผู้ดูแลระบบสูงสุด"
	case "admin":
		return "แอดมิน"
	case "user":
		return "ผู้ใช้งาน"
	case "":
		return "ระบบอัตโนมัติ"
	default:
		return role
	}
}

var userStatusThai = map[string]string{"active": "เปิดใช้งาน", "suspended": "ระงับ", "banned": "แบนถาวร"}

// securityTargetName finds a readable name for the event's target (a username instead of
// "user 2"). It runs before the embed is built because the builder does not touch the DB.
func (s *server) securityTargetName(ctx context.Context, event auditEvent) string {
	if name := fmtMetadata(event, "username"); name != "" && event.Target == "user" {
		return name
	}
	if name := fmtMetadata(event, "name"); name != "" && (event.Target == "hosting_database" || event.Target == "voice_room") {
		return name
	}
	if event.Target == "discord_bot" {
		return map[string]string{"nexora": "บอท NEXORA", "mail": "บอทเมล", "voice": "บอทห้องเสียง"}[event.TargetID]
	}
	id := strings.TrimSpace(event.TargetID)
	if id == "" || s.db == nil {
		return id
	}
	var name, extra string
	var err error
	switch event.Target {
	case "user":
		if _, parseErr := strconv.ParseInt(id, 10, 64); parseErr != nil {
			return id
		}
		err = s.db.QueryRow(ctx, `SELECT identifier FROM users WHERE id=$1`, id).Scan(&name)
	case "announcement":
		err = s.db.QueryRow(ctx, `SELECT title FROM announcements WHERE id::text=$1`, id).Scan(&name)
	case "hosting_site":
		err = s.db.QueryRow(ctx, `SELECT name, subdomain FROM hosting_sites WHERE public_id=$1`, id).Scan(&name, &extra)
		if err == nil && extra != "" && extra != name {
			name += " (" + extra + ")"
		}
	default:
		return id
	}
	if err != nil || strings.TrimSpace(name) == "" {
		return ""
	}
	return name
}

func buildDiscordEmbed(event auditEvent) fiber.Map {
	if event.Action == "discord.bot.activity" {
		return buildBotActivityEmbed(event)
	}
	copy, found := securityCopies[event.Action]
	if !found {
		copy = securityCopy{event.Action, "{actor} ทำรายการในระบบ", securityColorInfo}
	}
	failed := event.Outcome != "" && event.Outcome != "success"
	reason := fmtMetadata(event, "reason")
	details := []string{}

	switch event.Action {
	case "auth.login":
		if failed {
			copy = loginFailureCopy(event, reason)
		}
	case "auth.register":
		if failed {
			copy = securityCopy{"สมัครสมาชิกไม่สำเร็จ", map[string]string{
				"registration_disabled": "มีคนพยายามสมัครสมาชิก แต่ระบบปิดรับสมัครอยู่",
				"invalid_credentials":   "มีคนพยายามสมัครสมาชิก แต่ชื่อผู้ใช้ อีเมล หรือรหัสผ่านไม่ผ่านเงื่อนไข",
				"account_exists":        "มีคนพยายามสมัครด้วยชื่อผู้ใช้หรืออีเมลที่มีอยู่แล้ว",
			}[reason], securityColorWarn}
		}
	case "auth.oauth":
		if failed {
			copy = securityCopy{"เข้าสู่ระบบด้วย {provider} ไม่สำเร็จ", map[string]string{
				"":                      "{provider} ไม่ยืนยันการเข้าสู่ระบบ (ยกเลิกเอง หรือรหัสยืนยันหมดอายุ)",
				"account_link_required": "อีเมลจาก {provider} ตรงกับบัญชี {target} ที่มีอยู่แล้ว ต้องเข้าระบบด้วยรหัสผ่านแล้วเชื่อมจากหน้าโปรไฟล์ก่อน",
				"account_lookup":        "ระบบขัดข้องระหว่างค้นหาบัญชีที่เชื่อมกับ {provider}",
				"email_lookup":          "ระบบขัดข้องระหว่างตรวจอีเมลจาก {provider}",
				"account_create":        "ระบบขัดข้องระหว่างสร้างบัญชีใหม่จาก {provider}",
			}[reason], securityColorWarn}
		}
	case "password.changed":
		if failed {
			copy = securityCopy{"เปลี่ยนรหัสผ่านไม่สำเร็จ", "{actor} พยายามเปลี่ยนรหัสผ่าน แต่ใส่รหัสผ่านเดิมไม่ถูกต้อง", securityColorWarn}
		}
	case "user.status_changed":
		status := fmtMetadata(event, "status")
		switch status {
		case "active":
			copy = securityCopy{"เปิดใช้งานบัญชี", "{actor} เปิดใช้งานบัญชี {target} อีกครั้ง", securityColorInfo}
		case "suspended":
			copy = securityCopy{"ระงับบัญชี", "{actor} ระงับบัญชี {target} และให้ออกจากระบบทุกอุปกรณ์", securityColorDanger}
		case "banned":
			copy = securityCopy{"แบนบัญชี", "{actor} แบนบัญชี {target} ถาวร และให้ออกจากระบบทุกอุปกรณ์", securityColorDanger}
		}
	case "user.role_changed":
		if from, to := fmtMetadata(event, "oldRole"), fmtMetadata(event, "newRole"); from != "" && to != "" {
			copy.Text = "{actor} เปลี่ยนระดับสิทธิ์ของ {target} จาก **" + formatRoleThai(from) + "** เป็น **" + formatRoleThai(to) + "**"
		}
	case "user.created", "user.deleted":
		if role := fmtMetadata(event, "role"); role != "" {
			details = append(details, "สิทธิ์: "+formatRoleThai(role))
		}
	case "topup.settings_updated":
		if enabled, ok := event.Metadata["enabled"].(bool); ok {
			details = append(details, "ระบบเติมเงิน: "+map[bool]string{true: "เปิด", false: "ปิด"}[enabled])
		}
		if changed, _ := event.Metadata["tokenChanged"].(bool); changed {
			details = append(details, "เปลี่ยน API token")
		}
	case "hosting.site.created":
		if sub := fmtMetadata(event, "subdomain"); sub != "" {
			details = append(details, "ซับโดเมน: "+discordText(sub, 80))
		}
	case "hosting.database.suspended", "hosting.database.unsuspended":
		if count, _ := event.Metadata["count"].(int); count > 1 {
			verb := map[bool]string{true: "ระงับ", false: "ปลดระงับ"}[event.Action == "hosting.database.suspended"]
			copy.Text = fmt.Sprintf("{actor} %sฐานข้อมูล %d ตัวพร้อมกัน", verb, count)
			details = append(details, "ฐานข้อมูล: "+discordText(fmtMetadata(event, "name"), 900))
		}
		if failedNames := fmtMetadata(event, "failed"); failedNames != "" {
			details = append(details, "ทำไม่สำเร็จ: "+discordText(failedNames, 400))
		}
	case "ip.banned":
		if reason != "" {
			details = append(details, "เหตุผล: "+discordText(reason, 200))
		}
	case "lockdown.enabled":
		if reason != "" {
			details = append(details, "เหตุผล: "+discordText(reason, 200))
		}
		if expires, ok := event.Metadata["expiresAt"].(*time.Time); ok && expires != nil {
			details = append(details, "ปลดล็อกเองเมื่อ: "+thaiDateTime(*expires))
		} else {
			details = append(details, "ปลดล็อกเอง: ไม่กำหนด")
		}
	case "discord.voice.locked_out":
		details = append(details, fmt.Sprintf("ผิด %v ครั้ง ห้ามลอง %v นาที", event.Metadata["failures"], event.Metadata["lockoutMinutes"]))
	case "discord.voice.entry_denied":
		if member := fmtMetadata(event, "memberId"); validDiscordSnowflake(member) {
			details = append(details, "คนที่ถูกให้ออก: <@"+member+">")
		}
	case "workspace.security_alert":
		if attempts := event.Metadata["attempts"]; attempts != nil {
			copy.Text += fmt.Sprintf(" %v ครั้ง", attempts)
		}
		if host := fmtMetadata(event, "host"); host != "" {
			details = append(details, "โดเมน: "+discordText(host, 120))
		}
		if reason != "" {
			details = append(details, "ประเภท: "+discordText(reason, 80))
		}
	}
	// Alerts are failures by nature; anything else that failed without its own wording says so.
	if failed && (!found || copy.Title == securityCopies[event.Action].Title) && !securityAlertActions[event.Action] {
		copy.Title += " (ไม่สำเร็จ)"
		copy.Color = securityColorDanger
	}

	actor := securityActorName(event)
	target := securityTargetText(event)
	provider := oauthProviderNames[strings.ToLower(firstNonEmpty(fmtMetadata(event, "provider"), event.TargetID))]
	if provider == "" {
		provider = "บัญชีภายนอก"
	}
	fill := strings.NewReplacer("{actor}", actor, "{target}", target, "{provider}", provider)
	if copy.Text == "" {
		copy.Text = "ทำรายการไม่สำเร็จ"
	}

	fields := []fiber.Map{{"name": "ทำโดย", "value": securityActorField(event), "inline": true}}
	if event.IPAddress != "" {
		ip := "`" + discordText(event.IPAddress, 64) + "`"
		lan := event.LanIP
		if lan == "" {
			lan = fmtMetadata(event, "lanIP")
		}
		if lan != "" && lan != event.IPAddress {
			ip += "\nในวง LAN `" + discordText(lan, 64) + "`"
		}
		fields = append(fields,
			fiber.Map{"name": "IP", "value": ip, "inline": true},
			fiber.Map{"name": "อุปกรณ์", "value": discordText(parseUserAgent(event.UserAgent), 80), "inline": true},
		)
	}
	if len(details) > 0 {
		fields = append(fields, fiber.Map{"name": "รายละเอียด", "value": strings.Join(details, "\n"), "inline": false})
	}
	if event.IPAddress != "" {
		fields = append(fields, fiber.Map{"name": "ผู้ให้บริการเน็ต (จาก IP)", "value": securityLocation(event), "inline": false})
	}

	return fiber.Map{
		"title":       clipDiscordText(fill.Replace(copy.Title), 250),
		"description": fill.Replace(copy.Text),
		"color":       copy.Color,
		"fields":      fields,
		"footer":      securityFooter(""),
	}
}

func loginFailureCopy(event auditEvent, reason string) securityCopy {
	switch {
	case reason == "account_targeted":
		text := fmt.Sprintf("บัญชี {actor} ถูกใส่รหัสผ่านผิด %v ครั้งภายใน 15 นาที รวมจากหลาย IP ระบบหน่วงเวลาการเข้าสู่ระบบของชื่อนี้ไว้ แต่ไม่ล็อกบัญชี เจ้าของยังเข้าได้ตามปกติ", event.Metadata["attempt_count"])
		return securityCopy{"🚨 มีคนสุ่มรหัสผ่านบัญชีเดียวจากหลาย IP", text, securityColorThreat}
	case reason == "bruteforce_limit_reached" || (fmtMetadata(event, "threat") == "bruteforce" && reason != "ip_locked_out"):
		text := "ใส่รหัสผ่านผิดติดกันจนครบกำหนด ระบบพัก IP นี้ไว้ 15 นาที (ชื่อที่ใช้: {actor})"
		if count := event.Metadata["attempt_count"]; count != nil {
			text = fmt.Sprintf("ใส่รหัสผ่านผิดติดกัน %v ครั้ง ระบบพัก IP นี้ไว้ 15 นาที (ชื่อที่ใช้: {actor})", count)
		}
		return securityCopy{"🚨 สงสัยสุ่มรหัสผ่าน (Brute Force)", text, securityColorThreat}
	case reason == "ip_locked_out":
		text := "IP ที่ถูกพักไว้พยายามเข้าสู่ระบบอีกครั้ง (ชื่อที่ใช้: {actor})"
		if minutes := event.Metadata["minutes_left"]; minutes != nil {
			text = fmt.Sprintf("IP ที่ถูกพักไว้พยายามเข้าสู่ระบบอีกครั้ง เหลือเวลาพักอีกประมาณ %v นาที (ชื่อที่ใช้: {actor})", minutes)
		}
		return securityCopy{"🚨 IP ที่ถูกพักพยายามเข้าสู่ระบบ", text, securityColorThreat}
	case reason == "account_suspended":
		return securityCopy{"บัญชีที่ถูกระงับพยายามเข้าสู่ระบบ", "{actor} ใส่รหัสผ่านถูก แต่บัญชีถูกระงับอยู่ จึงเข้าไม่ได้", securityColorDanger}
	default:
		text := "มีคนพยายามเข้าสู่ระบบด้วยชื่อ {actor} แต่ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
		if count := fmt.Sprint(event.Metadata["attempt_count"]); event.Metadata["attempt_count"] != nil && count != "0" {
			text += fmt.Sprintf(" (ผิดครั้งที่ %s จาก %d)", count, maxFailedLoginAttempts)
		}
		return securityCopy{"เข้าสู่ระบบไม่สำเร็จ", text, securityColorWarn}
	}
}

// securityActorName is the actor as it reads inside the sentence.
func securityActorName(event auditEvent) string {
	switch {
	case event.Actor != nil && event.Actor.Username != "":
		return "**" + discordText(event.Actor.Username, 60) + "**"
	case validDiscordSnowflake(fmtMetadata(event, "discordActor")):
		return "<@" + fmtMetadata(event, "discordActor") + ">"
	case fmtMetadata(event, "username") != "":
		return "**" + discordText(fmtMetadata(event, "username"), 60) + "**"
	case event.IPAddress != "" && !isPrivateIP(event.IPAddress):
		return "ผู้เยี่ยมชมที่ยังไม่ได้เข้าสู่ระบบ"
	default:
		return "ระบบ"
	}
}

// securityActorField is the "ทำโดย" field: who it was and with what standing.
func securityActorField(event auditEvent) string {
	switch {
	case event.Actor != nil && event.Actor.Username != "":
		return "**" + discordText(event.Actor.Username, 60) + "**\n" + formatRoleThai(event.Actor.Role)
	case validDiscordSnowflake(fmtMetadata(event, "discordActor")):
		return "<@" + fmtMetadata(event, "discordActor") + ">\nผ่านบอท Discord"
	case fmtMetadata(event, "username") != "":
		return "**" + discordText(fmtMetadata(event, "username"), 60) + "**\nยังไม่ได้ยืนยันตัวตน"
	case event.IPAddress != "" && !isPrivateIP(event.IPAddress):
		return "ผู้เยี่ยมชม\nยังไม่ได้เข้าสู่ระบบ"
	default:
		return "ระบบอัตโนมัติ"
	}
}

func securityTargetText(event auditEvent) string {
	if event.Target == "ip" {
		return "`" + discordText(event.TargetID, 64) + "`"
	}
	if name := strings.TrimSpace(event.TargetName); name != "" {
		return "**" + discordText(name, 100) + "**"
	}
	switch event.Target {
	case "user":
		if event.TargetID != "" {
			return "บัญชี #" + discordText(event.TargetID, 40)
		}
		return "ผู้ใช้"
	case "hosting_site":
		return "`" + discordText(event.TargetID, 40) + "`"
	case "announcement":
		return "#" + discordText(event.TargetID, 40)
	}
	return discordText(event.TargetID, 80)
}

// securityLocation names the internet provider behind the IP. The city is only where the
// provider registered that IP block (3BB customers across the upper northeast show up as
// Udon Thani, for example), so it is shown as such and never as a point on a map.
func securityLocation(event auditEvent) string {
	if isPrivateIP(event.IPAddress) {
		return "เครือข่ายภายใน"
	}
	g := event.Geo
	if g == nil || (g.City == "" && g.Country == "" && g.ISP == "") {
		return "ไม่ทราบ"
	}
	lines := []string{}
	if provider := strings.Join(nonEmptyStrings(g.ISP, g.Country), " · "); provider != "" {
		lines = append(lines, "**"+discordText(provider, 160)+"**")
	}
	if g.City != "" {
		lines = append(lines, "พื้นที่ที่จดเลข IP: "+discordText(g.City, 120)+" (ไม่ใช่ตำแหน่งจริงของผู้ใช้)")
	}
	return strings.Join(lines, "\n")
}

func nonEmptyStrings(values ...string) []string {
	out := []string{}
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}
