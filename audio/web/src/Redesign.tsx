import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, Clock3, FileAudio, HelpCircle, Link2, ListMusic, LoaderCircle, Pencil, RotateCcw, X } from 'lucide-react'
import { createJob, downloadURL, getHealth, getJob, inspectMedia, type Inspection, type Job } from './api'
import { Modal } from './components/Modal'
import { Toast, type ToastMessage } from './components/Toast'

const qualityOptions: Record<string, { value: number; label: string }[]> = {
  mp3: [{ value: 128, label: '128 kbps · ไฟล์เล็ก' }, { value: 192, label: '192 kbps · สมดุล' }, { value: 256, label: '256 kbps · คุณภาพสูง' }, { value: 320, label: '320 kbps · สูงสุด' }],
  m4a: [{ value: 128, label: '128 kbps · ไฟล์เล็ก' }, { value: 192, label: '192 kbps · แนะนำ' }, { value: 256, label: '256 kbps · คุณภาพสูง' }],
  flac: [{ value: 0, label: 'Lossless · คุณภาพต้นทาง' }],
}
function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'ไม่ทราบระยะเวลา'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = Math.floor(seconds % 60)
  return hours > 0 ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remaining).padStart(2, '0') : minutes + ':' + String(remaining).padStart(2, '0')
}
function validateURL(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(parsed.hostname.toLowerCase())
  } catch { return false }
}
function estimateFileSize(seconds: number, format: string, quality: number) {
  if (!seconds) return '—'
  const megabytes = seconds * (format === 'flac' ? 900 : quality) / 8 / 1024
  return megabytes >= 1024 ? (megabytes / 1024).toFixed(1) + ' GB' : Math.max(1, Math.round(megabytes)) + ' MB'
}

export default function Redesign() {
  const [url, setURL] = useState('')
  const [inspectedURL, setInspectedURL] = useState('')
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState('mp3')
  const [quality, setQuality] = useState(320)
  const [metadata, setMetadata] = useState({ title: '', artist: '', album: '' })
  const [draft, setDraft] = useState(metadata)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [modal, setModal] = useState<'metadata' | 'help' | 'complete' | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const autoAttempt = useRef('')
  const noticeID = useRef(0)
  const finishedID = useRef('')
  const urlRef = useRef<HTMLInputElement>(null)
  const busy = isStarting || job?.status === 'queued' || job?.status === 'processing'
  const settingsLocked = busy || job?.status === 'completed'
  const selectedEntries = useMemo(() => inspection?.entries.filter(entry => selected.has(entry.id)) ?? [], [inspection, selected])
  const duration = selectedEntries.reduce((total, entry) => total + entry.duration, 0)
  const progress = Math.min(100, Math.max(0, job?.progress ?? 0))
  const dismissToast = useCallback(() => setToast(null), [])
  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => setToast({ id: ++noticeID.current, message, kind }), [])

  useEffect(() => {
    let active = true
    const check = () => getHealth().then(() => { if (active) setOnline(true) }).catch(() => { if (active) setOnline(false) })
    void check()
    const timer = window.setInterval(check, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  useEffect(() => () => controllerRef.current?.abort(), [])
  // A finished job is announced once: from the poll, or right away when it was already done.
  function finishJob(done: Job) {
    if (finishedID.current === done.id) return
    if (done.status === 'completed') {
      finishedID.current = done.id
      notify('แปลงไฟล์เรียบร้อย พร้อมดาวน์โหลดแล้ว')
      setModal('complete')
    } else if (done.status === 'failed') {
      finishedID.current = done.id
      notify(done.error || 'แปลงไฟล์ไม่สำเร็จ กรุณาลองใหม่', 'error')
    }
  }
  const onFinished = useEffectEvent((done: Job) => finishJob(done))
  const jobId = job?.id
  const jobStatus = job?.status
  useEffect(() => {
    if (!jobId || !jobStatus || jobStatus === 'completed' || jobStatus === 'failed') return
    let active = true
    let timer: number
    let warned = false
    const poll = async () => {
      try {
        const next = await getJob(jobId)
        if (!active) return
        setJob(next)
        if (next.status === 'completed' || next.status === 'failed') { onFinished(next); return }
      } catch {
        if (active && !warned) { notify('การเชื่อมต่อขัดข้อง กำลังลองอ่านสถานะใหม่', 'error'); warned = true }
      }
      if (active) timer = window.setTimeout(poll, 1000)
    }
    timer = window.setTimeout(poll, 500)
    return () => { active = false; window.clearTimeout(timer) }
  }, [jobId, jobStatus, notify])

  async function inspect(normalized: string) {
    if (busy || isInspecting) return
    if (!validateURL(normalized)) {
      setError('กรุณาใช้ลิงก์ YouTube แบบ HTTPS')
      notify('ลิงก์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', 'error')
      urlRef.current?.focus()
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    autoAttempt.current = normalized
    setError('')
    setIsInspecting(true)
    setInspection(null)
    setJob(null)
    try {
      const result = await inspectMedia(normalized, controller.signal)
      if (controller.signal.aborted) return
      setInspection(result)
      setInspectedURL(normalized)
      setSelected(new Set(result.kind === 'playlist' ? [] : result.entries.map(entry => entry.id)))
      setMetadata({ title: result.kind === 'video' ? result.title : '', artist: result.kind === 'video' ? result.artist : '', album: result.kind === 'playlist' ? result.title : result.entries[0]?.album ?? '' })
      notify(result.kind === 'playlist' ? 'พบ ' + result.count + ' เพลง เลือกรายการที่ต้องการได้เลย' : 'พบคลิปแล้ว พร้อมเลือกไฟล์เสียง')
    } catch (cause) {
      if (controller.signal.aborted) return
      const message = cause instanceof Error ? cause.message : 'อ่านข้อมูลคลิปไม่สำเร็จ'
      setError(message)
      notify(message, 'error')
    } finally { if (controllerRef.current === controller) setIsInspecting(false) }
  }
  // A pasted link is read on its own after typing stops.
  const autoInspect = useEffectEvent((normalized: string) => { void inspect(normalized) })
  useEffect(() => {
    const normalized = url.trim()
    if (!validateURL(normalized) || normalized === inspectedURL || normalized === autoAttempt.current || busy || isInspecting) return
    const timer = window.setTimeout(() => autoInspect(normalized), 650)
    return () => window.clearTimeout(timer)
  }, [url, inspectedURL, busy, isInspecting])
  function handleInspect(event: FormEvent) { event.preventDefault(); void inspect(url.trim()) }
  function handleURLChange(next: string) {
    setURL(next)
    setError('')
    if (!next.trim()) autoAttempt.current = ''
    if (next.trim() !== inspectedURL) { setInspection(null); setInspectedURL(''); setJob(null) }
  }
  function changeFormat(next: string) { setFormat(next); setQuality(next === 'mp3' ? 320 : next === 'm4a' ? 256 : 0) }
  function toggle(id: string) { setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  async function start() {
    if (!inspection || busy) return
    if (!selected.size) { notify('เลือกอย่างน้อย 1 เพลงก่อนเริ่มแปลง', 'error'); return }
    setIsStarting(true)
    setError('')
    try {
      const created = await createJob({ url: inspectedURL, format, quality, ...metadata, tracks: inspection.kind === 'playlist' ? [...selected] : undefined })
      setJob(created)
      notify('เริ่มแปลงไฟล์แล้ว')
      finishJob(created)
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'เริ่มงานไม่สำเร็จ', 'error') }
    finally { setIsStarting(false) }
  }
  function reset() {
    if (busy) return
    controllerRef.current?.abort()
    autoAttempt.current = ''
    setIsInspecting(false)
    setInspection(null)
    setInspectedURL('')
    setJob(null)
    setSelected(new Set())
    setError('')
    setURL('')
    setModal(null)
    urlRef.current?.focus()
  }
  function editMetadata() { setDraft({ ...metadata }); setModal('metadata') }

  return <div className={'audio-app ' + (inspection ? 'has-result' : '')}>
    <header className="site-header">
      <a className="wordmark" href="#top" aria-label="NEXORA Audio">nexora<span>.</span><small>audio</small></a>
      <div className="header-actions">
        <span className={'live-status ' + (online === false ? 'offline' : '')}><i />{online === false ? 'ระบบขัดข้อง' : online === null ? 'กำลังเชื่อมต่อ' : 'พร้อมใช้งาน'}</span>
        <button className="help-trigger" aria-label="วิธีใช้" onClick={() => setModal('help')}><HelpCircle size={17} /><span>วิธีใช้</span></button>
      </div>
    </header>
    <main id="top">
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow"><span className="eyebrow-line" />เครื่องมือแปลงเสียง</p>
        <h1 id="page-title">แปลงคลิปเป็น<br /><em>ไฟล์เสียง</em></h1>
        <p className="intro-copy">วางลิงก์ YouTube หรือ Playlist แล้วเลือกไฟล์ที่อยากได้</p>
        <form className="link-form" onSubmit={handleInspect}>
          <label htmlFor="source-url" className="sr-only">ลิงก์ YouTube</label>
          <div className={'link-field ' + (error ? 'invalid' : '')}>
            <Link2 className="link-icon" size={21} aria-hidden="true" />
            <input id="source-url" ref={urlRef} value={url} onChange={event => handleURLChange(event.target.value)} placeholder="วางลิงก์ YouTube ที่นี่" disabled={busy || isInspecting} spellCheck={false} autoComplete="url" aria-invalid={Boolean(error)} aria-describedby={error ? 'url-error' : 'link-hint'} />
            {url && !busy && !isInspecting && <button className="clear-link" type="button" onClick={() => handleURLChange('')} aria-label="ล้างลิงก์"><X size={17} /></button>}
            <button className="inspect-trigger" type="submit" disabled={!url.trim() || busy || isInspecting} aria-label={isInspecting ? 'กำลังตรวจสอบลิงก์' : 'ตรวจสอบลิงก์'}>{isInspecting ? <LoaderCircle className="spin" size={20} /> : <ArrowRight size={21} />}</button>
          </div>
          <div className="link-under"><span id="link-hint">{isInspecting ? 'กำลังอ่านข้อมูลคลิป…' : inspection ? 'เปลี่ยนลิงก์เพื่อเริ่มรายการใหม่' : 'วางลิงก์แล้วระบบจะอ่านข้อมูลให้อัตโนมัติ'}</span><span>รองรับวิดีโอและ Playlist</span></div>
          {error && <p className="input-error" id="url-error">{error}</p>}
        </form>
      </section>
      {inspection && <div className="result-flow">
        <div className="section-heading"><span className="section-number">01</span><div><p>ตรวจสอบรายการ</p><h2>{inspection.kind === 'playlist' ? 'เพลงใน Playlist' : 'คลิปของคุณ'}</h2></div></div>
        <section className="media-card" aria-label="ข้อมูลคลิป">
          <div className="media-cover">{inspection.thumbnail ? <img src={inspection.thumbnail} alt="รูปปกคลิป" /> : <FileAudio size={34} />}<span>{formatDuration(inspection.duration)}</span></div>
          <div className="media-main"><span className="media-type">{inspection.kind === 'playlist' ? 'รายการเพลง · ' + inspection.count + ' เพลง' : 'วิดีโอ YouTube'}</span><h3>{inspection.kind === 'video' ? metadata.title || inspection.title : inspection.title}</h3><p>{inspection.kind === 'video' ? metadata.artist || 'ไม่ระบุศิลปิน' : inspection.artist || 'ไม่ระบุศิลปิน'}</p>{metadata.album && (inspection.kind === 'video' || metadata.album !== inspection.title) && <span className="media-album">{metadata.album}</span>}<span className="media-time"><Clock3 size={14} />{formatDuration(inspection.duration)}</span></div>
          <button className="metadata-edit" disabled={settingsLocked} onClick={editMetadata}><Pencil size={16} /><span>แก้ข้อมูลเพลง</span></button>
        </section>
        {inspection.kind === 'playlist' && <section className="playlist-selection" aria-label="เลือกเพลงใน Playlist"><div className="playlist-top"><div><ListMusic size={18} /><strong>เลือกเพลงที่ต้องการ</strong><span>{selectedEntries.length} / {inspection.count}</span></div><button disabled={settingsLocked} onClick={() => setSelected(selectedEntries.length === inspection.entries.length ? new Set() : new Set(inspection.entries.map(entry => entry.id)))}>{selectedEntries.length === inspection.entries.length ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}</button></div><div className="tracks">{inspection.entries.map((entry, index) => <label className="track" key={entry.id + '-' + index}><input type="checkbox" checked={selected.has(entry.id)} disabled={settingsLocked} onChange={() => toggle(entry.id)} /><span className="track-number">{String(index + 1).padStart(2, '0')}</span><span className="track-info"><strong>{entry.title}</strong><small>{entry.artist}</small></span><span className="track-duration">{formatDuration(entry.duration)}</span></label>)}</div></section>}
        <div className="section-heading settings-heading"><span className="section-number">02</span><div><p>เลือกไฟล์</p><h2>ตั้งค่าเสียง</h2></div></div>
        <section className="settings-card" aria-label="ตั้งค่าไฟล์เสียง">
          <div className="settings-grid">
            <div><div className="setting-label"><span>รูปแบบไฟล์</span><small>เลือก 1 รูปแบบ</small></div><div className="format-choices" role="group" aria-label="รูปแบบไฟล์">{['mp3', 'm4a', 'flac'].map(value => <button key={value} type="button" className={format === value ? 'selected' : ''} aria-pressed={format === value} disabled={settingsLocked} onClick={() => changeFormat(value)}><span>{value.toUpperCase()}</span>{format === value && <Check size={16} />}</button>)}</div></div>
            <div><label className="setting-label" htmlFor="quality"><span>คุณภาพเสียง</span><small>ขึ้นอยู่กับเสียงต้นทาง</small></label><div className="quality-select"><select id="quality" value={quality} disabled={settingsLocked} onChange={event => setQuality(Number(event.target.value))}>{qualityOptions[format].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={17} /></div></div>
          </div>
          <p className="format-note">{format === 'mp3' ? 'MP3 ใช้ได้กับทุกอุปกรณ์ สูงสุด 320 kbps' : format === 'm4a' ? 'M4A ขนาดกะทัดรัด เหมาะกับมือถือ' : 'FLAC เก็บคุณภาพเสียงต้นทาง ไฟล์จะใหญ่ขึ้น'}</p>
          <div className="settings-bottom"><div className="file-summary"><span><strong>{selectedEntries.length}</strong> {selectedEntries.length === 1 ? 'ไฟล์' : 'เพลง'}</span><i /><span>{format.toUpperCase()}</span><i /><span>ประมาณ {estimateFileSize(duration, format, quality)}</span></div><span className="tag-note"><Check size={14} />ฝังข้อมูลเพลงและรูปปกให้</span></div>
        </section>
        <section className="action-section" aria-label="ดาวน์โหลดไฟล์เสียง">
          {!job || job.status === 'failed' ? <><button className="primary-action" disabled={busy || !selected.size} onClick={start}>{isStarting ? <LoaderCircle className="spin" size={19} /> : <ArrowDownToLine size={19} />}{isStarting ? 'กำลังเริ่มงาน' : job?.status === 'failed' ? 'ลองแปลงอีกครั้ง' : 'แปลงไฟล์เสียง'}<ArrowRight size={19} /></button>{job?.status === 'failed' && <p className="action-error">{job.error}</p>}</> : job.status === 'completed' ? <div className="completed-actions"><a className="primary-action" href={downloadURL(job.id)} download onClick={() => notify('ส่งไฟล์ให้เบราว์เซอร์แล้ว ตรวจสอบรายการดาวน์โหลดได้เลย')}><ArrowDownToLine size={19} />ดาวน์โหลดไฟล์<ArrowRight size={19} /></a><button className="restart-action" onClick={reset}><RotateCcw size={16} />เริ่มใหม่</button></div> : <div className="job-progress" aria-live="polite"><div className="progress-label"><span><LoaderCircle className="spin" size={16} />{job.stage}</span><strong>{Math.round(progress)}%</strong></div><div className="progress-track" role="progressbar" aria-label="ความคืบหน้า" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress + '%' }} /></div><p>{job.currentTitle || 'กำลังเตรียมข้อมูล'}{job.totalItems > 1 && ' · ' + job.currentItem + '/' + job.totalItems}</p></div>}
        </section>
      </div>}
    </main>
    <footer className="site-footer"><span>NEXORA AUDIO</span><span>ใช้กับสื่อที่คุณมีสิทธิ์ดาวน์โหลด</span></footer>
    <Toast toast={toast} onDismiss={dismissToast} />
    {modal === 'help' && <Modal title="เริ่มใช้งานใน 3 ขั้นตอน" description="วิดีโอเดี่ยวและ Playlist ใช้วิธีเดียวกัน" onClose={() => setModal(null)}><ol className="help-steps"><li><span>1</span><div><strong>วางลิงก์ YouTube</strong><p>ระบบจะอ่านชื่อคลิปและรายการเพลงให้อัตโนมัติ</p></div></li><li><span>2</span><div><strong>เลือกรูปแบบและคุณภาพ</strong><p>MP3 สูงสุด 320 kbps, M4A หรือ FLAC แก้ข้อมูลเพลงได้ก่อนเริ่ม</p></div></li><li><span>3</span><div><strong>แปลงแล้วดาวน์โหลด</strong><p>ดูความคืบหน้าบนหน้าเว็บ เมื่อเสร็จจะมีปุ่มดาวน์โหลด</p></div></li></ol><div className="modal-actions"><button className="button primary" onClick={() => setModal(null)}>เข้าใจแล้ว</button></div></Modal>}
    {modal === 'metadata' && <Modal title="แก้ไขข้อมูลเพลง" description="ข้อมูลนี้จะแสดงในแอปฟังเพลงของคุณ" onClose={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); setMetadata({ ...draft }); setModal(null); notify('บันทึกข้อมูลเพลงแล้ว') }}><div className="metadata-fields">{inspection?.kind === 'video' && <><label>ชื่อเพลง<input autoFocus required maxLength={100} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>ศิลปิน<input maxLength={100} value={draft.artist} onChange={event => setDraft({ ...draft, artist: event.target.value })} /></label></>}<label>อัลบั้ม<input autoFocus={inspection?.kind === 'playlist'} maxLength={100} value={draft.album} placeholder="ไม่ระบุอัลบั้ม" onChange={event => setDraft({ ...draft, album: event.target.value })} /></label></div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>ยกเลิก</button><button className="button primary">บันทึกข้อมูล</button></div></form></Modal>}
    {modal === 'complete' && job?.status === 'completed' && <Modal title="ไฟล์ของคุณพร้อมแล้ว" description="แปลงเสียงและบันทึกข้อมูลเพลงเรียบร้อย" onClose={() => setModal(null)}><div className="download-file"><span><FileAudio size={28} /></span><div><strong>{job.filename}</strong><small>{job.totalItems > 1 ? job.totalItems + ' เพลงในไฟล์ ZIP' : format.toUpperCase() + ' · ' + (quality ? quality + ' kbps' : 'Lossless')}</small></div><span className="download-check"><Check size={16} /></span></div><p className="download-retention">ไฟล์เก็บไว้ชั่วคราวประมาณ 2 ชั่วโมง แนะนำให้ดาวน์โหลดตอนนี้</p><div className="modal-actions"><button className="button secondary" onClick={() => setModal(null)}>กลับหน้าหลัก</button><a className="button primary" href={downloadURL(job.id)} download onClick={() => { setModal(null); notify('ส่งไฟล์ให้เบราว์เซอร์แล้ว ตรวจสอบรายการดาวน์โหลดได้เลย') }}><ArrowDownToLine size={17} />ดาวน์โหลด</a></div></Modal>}
  </div>
}
