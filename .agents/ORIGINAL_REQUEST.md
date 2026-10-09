# Original User Request

## 2026-08-29T21:44:45Z

พัฒนาระบบ File Explorer และ Code Editor สไตล์ VS Code สำหรับอัปเกรดตัวจัดการไฟล์ในหน้า Hosting ของแพลตฟอร์ม NEXORA Cloud ให้ผู้ใช้สามารถดูโครงสร้างโฟลเดอร์แบบ Tree View, เปิดไฟล์หลายแท็บพร้อมกัน (Multi-tabs), ดูและแก้ไขโค้ดด้วย CodeMirror 6 พร้อม Syntax Highlighting, และบันทึกไฟล์กลับไปยัง Hosting API ได้อย่างสมบูรณ์

Working directory: c:\Users\nkn246\Desktop\nkn-v6-new-ui
Integrity mode: development

## Requirements

### R1. VS Code-style Explorer & Multi-Tab Workspace UI
- อัปเกรดหน้าต่างจัดการไฟล์ (File Manager) ใน `app/dashboard/HostingView.tsx` (หรือแยกเป็นโมดูลย่อย `app/components/code-workspace/`)
- Sidebar ด้านซ้าย: File Tree แบบโครงสร้างลำดับชั้น (Hierarchical Tree View) ยุบ/ขยายโฟลเดอร์ได้ พร้อมไอคอนแยกตามนามสกุลไฟล์
- ด้านบนของ Editor: Tab Bar ที่เปิดหลายไฟล์พร้อมกันได้ สลับแท็บ ปิดแท็บ และแสดงจุดบอกสถานะการแก้ไข (Unsaved Indicator)
- เมนูจัดการไฟล์ด่วน: สร้างไฟล์/โฟลเดอร์, เปลี่ยนชื่อ, อัปโหลด, ดาวน์โหลด, บีบอัด/แตกไฟล์ ZIP

### R2. CodeMirror 6 Editor Component
- ฝัง CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search` และส่วนขยายภาษา)
- รองรับ Syntax Highlighting สำหรับภาษาหลัก: PHP, JavaScript, TypeScript, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML
- แสดงหมายเลขบรรทัด (Line Numbers), Active Line Highlighting, Code Folding, และกล่องค้นหาข้อความ (Ctrl+F Search / Replace)
- ธีมสี Dark Editor ที่กลมกลืนกับดีไซน์ NEXORA Cloud และรองรับ Touch / Mobile Friendly

### R3. State Management, Diff Confirmation & Hosting API Sync
- จัดการ State ของแต่ละแท็บไฟล์ (ไฟล์ที่เปิดอยู่, เนื้อหาเดิม, เนื้อหาที่ถูกแก้ไข, dirty flag) อย่างเป็นอิสระ
- เมื่อกดบันทึก (Ctrl+S หรือปุ่มบันทึก) ให้เรียกใช้งาน Hosting Files API (`/api/hosting/sites/:id/files/...`) เพื่อบันทึกไฟล์
- มีหน้าต่างตรวจสอบความแตกต่าง (Diff Dialog) หรือระบบยืนยันก่อนบันทึก และแจ้งเตือนเมื่อจะปิดแท็บที่มีการแก้ไขค้างอยู่
- เคารพสิทธิ์การเข้าถึง (Viewer = Read-only mode ห้ามแก้ไข/บันทึก)

## Acceptance Criteria

### Explorer & Multi-Tabs
- [ ] โฟลเดอร์ใน Tree View สามารถคลิกเพื่อกางออก (Expand) และหุบเข้า (Collapse) ได้ถูกต้องหลายชั้น
- [ ] การคลิกไฟล์ใน Tree จะเปิดไฟล์ขึ้นแท็บใหม่ หรือสลับไปยังแท็บเดิมหากเปิดไว้อยู่แล้ว
- [ ] สามารถสลับแท็บไปมาโดยที่เนื้อหาโค้ดที่พิมพ์ค้างไว้ไม่สูญหาย
- [ ] มีปุ่มปิดแท็บ (X) และมี Dialog ยืนยันหากไฟล์นั้นมี Unsaved Changes

### CodeMirror 6 Features
- [ ] โค้ดของภาษาต่าง ๆ (.php, .js, .ts, .json, .html, .css ฯลฯ) มีการไฮไลต์สีไวยากรณ์ถูกต้องตามประเภทไฟล์
- [ ] แสดงหมายเลขบรรทัด และสามารถกดค้นหาข้อความในไฟล์ได้ด้วยคีย์ลัด Ctrl+F
- [ ] รองรับการแสดงผลทั้งบนจอ Desktop และอุปกรณ์มือถือ/แท็บเล็ต

### File Operations & Backend Integrity
- [ ] ผู้ใช้สามารถกด Save เพื่อบันทึกไฟล์กลับไปยัง Hosting API ได้สำเร็จ
- [ ] เมนูสร้างไฟล์ใหม่, สร้างโฟลเดอร์, ลบไฟล์, และอัปโหลดไฟล์ ทำงานได้ถูกต้องร่วมกับ Tree View
- [ ] บัญชีที่มีสิทธิ์ Viewer จะไม่สามารถพิมพ์แก้ไขหรือกดบันทึกได้
