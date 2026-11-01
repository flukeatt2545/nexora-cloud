-- Plainer default wording on the sign-in dialog. Only the old defaults change; text an admin
-- wrote stays as it is.
ALTER TABLE system_settings ALTER COLUMN login_title SET DEFAULT 'เข้าสู่ระบบ';
ALTER TABLE system_settings ALTER COLUMN login_subtitle SET DEFAULT 'NEXORA CLOUD';
ALTER TABLE system_settings ALTER COLUMN register_title SET DEFAULT 'สมัครสมาชิก';
ALTER TABLE system_settings ALTER COLUMN register_subtitle SET DEFAULT 'NEXORA CLOUD';
UPDATE system_settings SET login_title = 'เข้าสู่ระบบ' WHERE login_title = 'ยินดีต้อนรับกลับมา';
UPDATE system_settings SET login_subtitle = 'NEXORA CLOUD' WHERE login_subtitle = 'ลงชื่อเข้าใช้ NEXORA CLOUD';
UPDATE system_settings SET register_title = 'สมัครสมาชิก' WHERE register_title = 'เริ่มต้นกับ NEXORA';
UPDATE system_settings SET register_subtitle = 'NEXORA CLOUD' WHERE register_subtitle = 'สร้างบัญชีเพื่อเริ่มใช้งาน Cloud';
