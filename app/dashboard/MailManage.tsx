"use client";

import { Globe2, KeyRound, MailPlus, Plus, RefreshCw, Smartphone, UserPlus, Users, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useEscape, useScrollLock } from "./useScrollLock";
import { api, bytes, CopyButton, fullDate, type Domain, type Mailbox, type Notice } from "./mailShared";

type DeviceSettings = {
  ready: boolean;
  provisionState: string;
  lastError?: string;
  address: string;
  incoming: { host: string; port: number; security: string };
  outgoing: { host: string; port: number; security: string };
  credentials: { id: string; description: string; createdAt: string }[];
};
type Tab = "box" | "new" | "domains";

const domainStatus: Record<string, { label: string; tone: string }> = {
  active: { label: "ใช้งานได้", tone: "is-ok" },
  pending_dns: { label: "รอตั้ง DNS", tone: "is-wait" },
  pending_approval: { label: "รออนุมัติ", tone: "is-wait" },
  failed: { label: "DNS ไม่ผ่าน", tone: "is-bad" },
  suspended: { label: "ระงับอยู่", tone: "is-off" },
};
const recordStatus: Record<string, { label: string; tone: string }> = {
  verified: { label: "ผ่าน", tone: "is-ok" },
  pending: { label: "กำลังตรวจ", tone: "is-wait" },
  not_started: { label: "ยังไม่ตั้ง", tone: "is-off" },
  failed: { label: "ไม่ผ่าน", tone: "is-bad" },
  temporary_failure: { label: "ไม่ผ่าน", tone: "is-bad" },
};
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** Copyable setting: a label, the value in a monospace face, and a copy button. */
function SettingRow({ label, value, copyLabel, onError }: { label: string; value: string; copyLabel: string; onError: () => void }) {
  return (
    <div className="wm-setting">
      <span className="wm-setting-label">{label}</span>
      <code className="wm-setting-value">{value}</code>
      <CopyButton value={value} label={copyLabel} onError={onError} />
    </div>
  );
}

export default function MailManage({ mailbox, notify, onChanged, onClose }: {
  mailbox?: Mailbox;
  notify: Notice;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const isOwner = mailbox?.role === "owner";
  const [tab, setTab] = useState<Tab>(isOwner ? "box" : "new");
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [busy, setBusy] = useState("");
  const [domainName, setDomainName] = useState("");
  const [newBox, setNewBox] = useState({ domainId: "", localPart: "", displayName: "" });
  const [memberName, setMemberName] = useState("");
  const [aliasName, setAliasName] = useState("");
  const [device, setDevice] = useState<DeviceSettings | null>(null);
  const [devicePassword, setDevicePassword] = useState("");
  const [revoking, setRevoking] = useState("");
  const copyFailed = () => notify({ kind: "error", text: "คัดลอกไม่ได้ ลองคลิกที่หน้าเว็บแล้วกดอีกครั้ง" });

  useScrollLock(true);
  useEscape(true, onClose);

  const loadDomains = () => api<{ items: Domain[] }>("/api/mail/domains").then((data) => setDomains(data.items || []));
  useEffect(() => {
    api<{ items: Domain[] }>("/api/mail/domains")
      .then((data) => setDomains(data.items || []))
      .catch((error) => { setDomains([]); notify({ kind: "error", text: (error as Error).message }); });
  }, [notify]);

  const activeDomains = (domains || []).filter((item) => item.status === "active");
  const mailboxDomain = mailbox?.address.split("@")[1] || "";

  async function run(key: string, task: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await task();
      if (done) notify({ kind: "success", text: done });
      return true;
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createDomain(event: FormEvent) {
    event.preventDefault();
    const ok = await run("domain", async () => {
      await api("/api/mail/domains", { method: "POST", body: JSON.stringify({ domain: domainName.trim(), kind: "custom" }) });
      await loadDomains();
    }, "เพิ่มโดเมนแล้ว ขั้นต่อไปคือเพิ่มระเบียน DNS ตามตารางด้านล่าง");
    if (ok) setDomainName("");
  }
  async function createMailbox(event: FormEvent) {
    event.preventDefault();
    const ok = await run("mailbox", async () => {
      await api("/api/mail/mailboxes", { method: "POST", body: JSON.stringify(newBox) });
      await Promise.all([onChanged(), loadDomains()]);
    }, "สร้างกล่องอีเมลแล้ว");
    if (ok) setNewBox({ ...newBox, localPart: "", displayName: "" });
  }
  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!mailbox) return;
    const ok = await run("member", () => api(`/api/mail/mailboxes/${mailbox.id}/members`, { method: "POST", body: JSON.stringify({ username: memberName.trim() }) }), `เพิ่ม @${memberName.trim()} เข้ากล่องนี้แล้ว`);
    if (ok) setMemberName("");
  }
  async function addAlias(event: FormEvent) {
    event.preventDefault();
    if (!mailbox) return;
    const ok = await run("alias", () => api(`/api/mail/mailboxes/${mailbox.id}/aliases`, { method: "POST", body: JSON.stringify({ localPart: aliasName.trim() }) }), `เพิ่ม ${aliasName.trim()}@${mailboxDomain} แล้ว`);
    if (ok) setAliasName("");
  }
  const loadDevice = () => mailbox && run("device", async () => setDevice(await api<DeviceSettings>(`/api/mail/mailboxes/${mailbox.id}/device-settings`)));
  const createPassword = () => mailbox && run("device", async () => {
    const result = await api<{ password: string }>(`/api/mail/mailboxes/${mailbox.id}/device-passwords`, { method: "POST", body: JSON.stringify({ description: "iPhone" }) });
    setDevicePassword(result.password);
    setDevice(await api<DeviceSettings>(`/api/mail/mailboxes/${mailbox.id}/device-settings`));
  }, "สร้างรหัสผ่านแล้ว คัดลอกเก็บไว้ ระบบจะแสดงครั้งเดียว");
  const revokePassword = (id: string) => mailbox && run("device", async () => {
    await api(`/api/mail/mailboxes/${mailbox.id}/device-passwords/${id}`, { method: "DELETE" });
    setDevicePassword("");
    setRevoking("");
    setDevice(await api<DeviceSettings>(`/api/mail/mailboxes/${mailbox.id}/device-settings`));
  }, "ยกเลิกรหัสผ่านแล้ว อุปกรณ์ที่ใช้รหัสนี้จะรับส่งเมลไม่ได้");
  const verify = (item: Domain) => run(`verify:${item.id}`, async () => {
    await api(`/api/mail/domains/${item.id}/verify`, { method: "POST" });
    await loadDomains();
  }, "ตรวจ DNS แล้ว");

  const tabs: { id: Tab; label: string; icon: typeof Globe2 }[] = [
    ...(isOwner ? [{ id: "box" as const, label: "กล่องนี้", icon: Smartphone }] : []),
    { id: "new", label: "สร้างกล่องอีเมล", icon: MailPlus },
    { id: "domains", label: "โดเมน", icon: Globe2 },
  ];

  return (
    <div className="wm-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="wm-dialog wm-manage" role="dialog" aria-modal="true" aria-labelledby="wm-manage-title">
        <header className="wm-dialog-head">
          <div>
            <h2 id="wm-manage-title">จัดการอีเมล</h2>
            {mailbox && <p>{mailbox.address} · ใช้ไป {bytes(mailbox.usedBytes)} จาก {bytes(mailbox.quotaBytes)}</p>}
          </div>
          <button type="button" className="wm-icon-btn" onClick={onClose} aria-label="ปิด"><X size={18} aria-hidden="true" /></button>
        </header>
        <nav className="wm-tabs" role="tablist" aria-label="หัวข้อ">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" id={`wm-tab-${item.id}`} aria-controls="wm-manage-panel" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
              <item.icon size={16} aria-hidden="true" /> {item.label}
            </button>
          ))}
        </nav>

        <div className="wm-dialog-body" id="wm-manage-panel" role="tabpanel" aria-labelledby={`wm-tab-${tab}`}>
          {tab === "box" && mailbox && (
            <>
              <section className="wm-section">
                <header className="wm-section-head">
                  <div>
                    <h3>ใช้ในแอปอีเมลบนมือถือ</h3>
                    <p>เช่น Mail บน iPhone หรือ Outlook ใส่ค่าด้านล่างตอนเพิ่มบัญชีแบบ IMAP</p>
                  </div>
                  <button type="button" className="wm-btn" onClick={() => void loadDevice()} disabled={busy === "device"}>
                    <RefreshCw size={15} aria-hidden="true" className={busy === "device" ? "wm-spin" : ""} /> {device ? "โหลดใหม่" : "ดูค่าที่ต้องใส่"}
                  </button>
                </header>
                {device && (
                  <>
                    <div className="wm-settings">
                      <SettingRow label="อีเมล / ชื่อผู้ใช้" value={device.address} copyLabel="อีเมล" onError={copyFailed} />
                      <SettingRow label="เซิร์ฟเวอร์ขาเข้า (IMAP)" value={device.incoming.host} copyLabel="ชื่อเซิร์ฟเวอร์" onError={copyFailed} />
                      <div className="wm-setting-meta">พอร์ต {device.incoming.port} · {device.incoming.security}</div>
                      <SettingRow label="เซิร์ฟเวอร์ขาออก (SMTP)" value={device.outgoing.host} copyLabel="ชื่อเซิร์ฟเวอร์" onError={copyFailed} />
                      <div className="wm-setting-meta">พอร์ต {device.outgoing.port} · {device.outgoing.security}</div>
                    </div>
                    {devicePassword && (
                      <div className="wm-secret" role="status">
                        <span>รหัสผ่านสำหรับอุปกรณ์ คัดลอกตอนนี้ ปิดหน้านี้แล้วจะดูอีกไม่ได้</span>
                        <div className="wm-setting">
                          <code className="wm-setting-value">{devicePassword}</code>
                          <CopyButton value={devicePassword} label="รหัสผ่าน" withText onError={copyFailed} />
                        </div>
                      </div>
                    )}
                    {!device.ready && <p className="wm-error-text">{device.lastError || "กล่องนี้ยังเชื่อมกับเซิร์ฟเวอร์รับเมลไม่สำเร็จ จึงยังสร้างรหัสผ่านไม่ได้"}</p>}
                    <div className="wm-row-actions">
                      <button type="button" className="wm-btn wm-btn-primary" onClick={() => void createPassword()} disabled={busy === "device" || !device.ready}>
                        <KeyRound size={15} aria-hidden="true" /> สร้างรหัสผ่านอุปกรณ์
                      </button>
                    </div>
                    {device.credentials.length > 0 && (
                      <ul className="wm-credentials" aria-label="รหัสผ่านอุปกรณ์ที่ใช้อยู่">
                        {device.credentials.map((credential) => (
                          <li key={credential.id}>
                            <span>
                              <strong>{credential.description || "อุปกรณ์"}</strong>
                              <small>สร้างเมื่อ {fullDate(credential.createdAt)}</small>
                            </span>
                            {revoking === credential.id ? (
                              <span className="wm-inline-confirm">
                                <button type="button" className="wm-btn" onClick={() => setRevoking("")}>ไม่ยกเลิก</button>
                                <button type="button" className="wm-btn wm-btn-danger" onClick={() => void revokePassword(credential.id)} disabled={busy === "device"}>ยืนยันยกเลิก</button>
                              </span>
                            ) : (
                              <button type="button" className="wm-btn wm-btn-ghost-danger" onClick={() => setRevoking(credential.id)}>ยกเลิกรหัสนี้</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>

              <section className="wm-section">
                <header className="wm-section-head">
                  <div>
                    <h3><Users size={16} aria-hidden="true" /> ให้คนอื่นใช้กล่องนี้ด้วย</h3>
                    <p>ใส่ชื่อผู้ใช้ NEXORA ของคนนั้น เขาจะเห็นกล่องนี้ในหน้าอีเมลของเขา</p>
                  </div>
                </header>
                <form className="wm-inline-form" onSubmit={(event) => void addMember(event)}>
                  <label className="wm-sr" htmlFor="wm-member">ชื่อผู้ใช้</label>
                  <input id="wm-member" className="wm-input" value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="ชื่อผู้ใช้" autoCapitalize="none" spellCheck={false} />
                  <button type="submit" className="wm-btn" disabled={!memberName.trim() || busy === "member"}><UserPlus size={15} aria-hidden="true" /> เพิ่มสมาชิก</button>
                </form>
              </section>

              <section className="wm-section">
                <header className="wm-section-head">
                  <div>
                    <h3>ชื่ออีเมลเพิ่มเติม (Alias)</h3>
                    <p>อีเมลที่ส่งมาที่ชื่อนี้จะเข้ากล่อง {mailbox.address}</p>
                  </div>
                </header>
                <form className="wm-inline-form" onSubmit={(event) => void addAlias(event)}>
                  <label className="wm-sr" htmlFor="wm-alias">ชื่ออีเมล</label>
                  <span className="wm-address-input">
                    <input id="wm-alias" value={aliasName} onChange={(event) => setAliasName(event.target.value)} placeholder="support" autoCapitalize="none" spellCheck={false} />
                    <span>@{mailboxDomain}</span>
                  </span>
                  <button type="submit" className="wm-btn" disabled={!aliasName.trim() || busy === "alias"}><Plus size={15} aria-hidden="true" /> เพิ่ม Alias</button>
                </form>
              </section>
            </>
          )}

          {tab === "new" && (
            <form className="wm-section wm-form" onSubmit={(event) => void createMailbox(event)}>
              {domains && !activeDomains.length ? (
                <p className="wm-note">ยังไม่มีโดเมนที่ใช้งานได้ เพิ่มโดเมนและตั้งค่า DNS ในแท็บ <button type="button" className="wm-link" onClick={() => setTab("domains")}>โดเมน</button> ก่อน</p>
              ) : null}
              <div className="wm-form-field">
                <label htmlFor="wm-new-local">ที่อยู่อีเมล</label>
                <span className="wm-address-input">
                  <input id="wm-new-local" value={newBox.localPart} onChange={(event) => setNewBox({ ...newBox, localPart: event.target.value })} placeholder="contact" required autoCapitalize="none" spellCheck={false} />
                  <select aria-label="โดเมน" value={newBox.domainId} onChange={(event) => setNewBox({ ...newBox, domainId: event.target.value })} required>
                    <option value="">@ เลือกโดเมน</option>
                    {activeDomains.map((item) => <option key={item.id} value={item.id}>@{item.domain}</option>)}
                  </select>
                </span>
              </div>
              <div className="wm-form-field">
                <label htmlFor="wm-new-name">ชื่อที่ผู้รับเห็น</label>
                <input id="wm-new-name" className="wm-input" value={newBox.displayName} onChange={(event) => setNewBox({ ...newBox, displayName: event.target.value })} placeholder="เช่น ฝ่ายขาย" />
              </div>
              <div className="wm-row-actions">
                <button type="submit" className="wm-btn wm-btn-primary" disabled={busy === "mailbox" || !newBox.domainId || !newBox.localPart.trim()}>
                  <MailPlus size={15} aria-hidden="true" /> {busy === "mailbox" ? "กำลังสร้าง..." : "สร้างกล่องอีเมล"}
                </button>
              </div>
            </form>
          )}

          {tab === "domains" && (
            <>
              <form className="wm-section wm-inline-form" onSubmit={(event) => void createDomain(event)}>
                <label className="wm-sr" htmlFor="wm-domain">โดเมน</label>
                <input id="wm-domain" className="wm-input" value={domainName} onChange={(event) => setDomainName(event.target.value)} placeholder="example.com" required inputMode="url" autoCapitalize="none" spellCheck={false} />
                <button type="submit" className="wm-btn wm-btn-primary" disabled={!domainName.trim() || busy === "domain"}><Plus size={15} aria-hidden="true" /> เพิ่มโดเมน</button>
              </form>
              {domains === null ? (
                <p className="wm-note">กำลังโหลด...</p>
              ) : !domains.length ? (
                <p className="wm-note">ยังไม่มีโดเมน ใส่ชื่อโดเมนด้านบน แล้วระบบจะบอกค่า DNS ที่ต้องเพิ่ม</p>
              ) : (
                <ul className="wm-domains">
                  {domains.map((item) => {
                    const state = domainStatus[item.status] || { label: item.status.replaceAll("_", " "), tone: "is-off" };
                    const records = item.dnsRecords || [];
                    return (
                      <li key={item.id} className="wm-domain">
                        <div className="wm-domain-head">
                          <span>
                            <strong>{item.domain}</strong>
                            <small>{item.mailboxCount} กล่อง</small>
                          </span>
                          <span className={`wm-pill ${state.tone}`}>{state.label}</span>
                          <button type="button" className="wm-btn" onClick={() => void verify(item)} disabled={busy === `verify:${item.id}`}>
                            <RefreshCw size={15} aria-hidden="true" className={busy === `verify:${item.id}` ? "wm-spin" : ""} /> ตรวจ DNS
                          </button>
                        </div>
                        {records.length > 0 && (
                          <details className="wm-dns" open={item.status !== "active"}>
                            <summary>ระเบียน DNS {records.length} รายการ</summary>
                            <ul>
                              {records.map((record, index) => {
                                const name = text(record.name) || "@";
                                const value = text(record.value ?? record.content);
                                const priority = text(record.priority);
                                const rs = recordStatus[text(record.status)] || { label: text(record.status) || "-", tone: "is-off" };
                                return (
                                  <li key={index} className="wm-dns-record">
                                    <span className="wm-dns-type">{text(record.type)}{priority && <small>ลำดับ {priority}</small>}</span>
                                    <span className={`wm-pill ${rs.tone}`}>{rs.label}</span>
                                    <SettingRow label="ชื่อ" value={name} copyLabel="ชื่อระเบียน" onError={copyFailed} />
                                    <SettingRow label="ค่า" value={value} copyLabel="ค่าระเบียน" onError={copyFailed} />
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
