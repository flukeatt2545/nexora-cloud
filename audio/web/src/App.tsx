import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, Clock3, Disc3, FileAudio, HelpCircle, Link2, ListMusic, LoaderCircle, Music2, Pencil, Plus, SlidersHorizontal, X } from 'lucide-react'
import { createJob, downloadURL, getHealth, getJob, inspectMedia, type Inspection, type Job } from './api'
import { Modal } from './components/Modal'
import { Toast, type ToastMessage } from './components/Toast'

const qualityOptions: Record<string, { value: number; label: string; hint: string }[]> = {
  mp3: [
    { value: 128, label: '128 kbps', hint: 'ไฟล์เล็ก' },
    { value: 192, label: '192 kbps', hint: 'สมดุล' },
    { value: 256, label: '256 kbps', hint: 'คุณภาพสูง' },
    { value: 320, label: '320 kbps', hint: 'สูงสุด' },
  ],
  m4a: [
    { value: 128, label: '128 kbps', hint: 'ไฟล์เล็ก' },
    { value: 192, label: '192 kbps', hint: 'แนะนำ' },
    { value: 256, label: '256 kbps', hint: 'คุณภาพสูง' },
  ],
  flac: [{ value: 0, label: 'Lossless', hint: 'ไม่บีบอัดคุณภาพ' }],
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'ไม่ทราบระยะเวลา'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = Math.floor(seconds % 60)
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

function validateURL(value: string) {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    return parsed.protocol === 'https:' && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)
  } catch {
    return false
  }
}

function estimateFileSize(seconds: number, format: string, quality: number) {
  if (!seconds) return ''
  const bitrate = format === 'flac' ? 900 : quality
  const megabytes = (seconds * bitrate) / 8 / 1024
  return megabytes >= 1024 ? `ประมาณ ${(megabytes / 1024).toFixed(1)} GB` : `ประมาณ ${Math.max(1, Math.round(megabytes))} MB`
}


export default function App() {
  const [url, setURL] = useState('')
  const [inspectedURL, setInspectedURL] = useState('')
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState('mp3')
  const [quality, setQuality] = useState(320)
  const [metadata, setMetadata] = useState({title:'', artist:'', album:''})
  const [draft, setDraft] = useState(metadata)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [modal, setModal] = useState<'metadata' | 'help' | 'complete' | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const noticeID = useRef(0)
  const finishedID = useRef('')
  const urlRef = useRef<HTMLInputElement>(null)
  const busy = isStarting || job?.status === 'queued' || job?.status === 'processing'
  const settingsLocked = busy || job?.status === 'completed'
  const selectedEntries = useMemo(() => inspection?.entries.filter(entry => selected.has(entry.id)) ?? [], [inspection, selected])
  const duration = selectedEntries.reduce((total, entry) => total + entry.duration, 0)
  const progress = Math.min(100, Math.max(0, job?.progress ?? 0))
  const dismissToast = useCallback(() => setToast(null), [])
  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({id: ++noticeID.current, message, kind})
  }, [])

  useEffect(() => {
    let active = true
    const check = () => getHealth().then(() => active && setOnline(true)).catch(() => active && setOnline(false))
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
    if (!jobId || !jobStatus || ['completed', 'failed'].includes(jobStatus)) return
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

  async function handleInspect(event: FormEvent) {
    event.preventDefault()
    if (busy || isInspecting) return
    const normalized = url.trim()
    if (!validateURL(normalized)) {
      setError('กรุณาใช้ลิงก์ YouTube แบบ HTTPS เช่น https://youtu.be/…')
      notify('ลิงก์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', 'error')
      urlRef.current?.focus()
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setError(''); setIsInspecting(true); setInspection(null); setJob(null)
    try {
      const result = await inspectMedia(normalized, controller.signal)
      if (controller.signal.aborted) return
      setInspection(result); setInspectedURL(normalized)
      setSelected(new Set(result.entries.map(entry => entry.id)))
      setMetadata({title: result.kind === 'video' ? result.title : '', artist: result.kind === 'video' ? result.artist : '', album: result.kind === 'playlist' ? result.title : result.entries[0]?.album ?? ''})
      notify(result.kind === 'playlist' ? 'พบ ' + result.count + ' เพลง เลือกรายการที่ต้องการได้เลย' : 'พบคลิปแล้ว เลือกรูปแบบและเริ่มแปลงได้เลย')
    } catch (cause) {
      if (controller.signal.aborted) return
      const message = cause instanceof Error ? cause.message : 'อ่านข้อมูลคลิปไม่สำเร็จ'
      setError(message); notify(message, 'error')
    } finally {
      if (controllerRef.current === controller) setIsInspecting(false)
    }
  }
  function changeFormat(next: string) {
    setFormat(next); setQuality(next === 'mp3' ? 320 : next === 'm4a' ? 256 : 0)
  }
  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  async function start() {
    if (!inspection || busy) return
    if (!selected.size) { notify('เลือกอย่างน้อย 1 เพลงก่อนเริ่มแปลง', 'error'); return }
    setIsStarting(true); setError('')
    try {
      const created = await createJob({url: inspectedURL, format, quality, ...metadata, tracks: inspection.kind === 'playlist' ? [...selected] : undefined})
      setJob(created); notify('เพิ่มงานในคิวแล้ว กำลังเตรียมไฟล์ให้คุณ')
      finishJob(created)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'เริ่มงานไม่สำเร็จ', 'error')
    } finally { setIsStarting(false) }
  }
  function reset() {
    if (busy) return
    controllerRef.current?.abort()
    setIsInspecting(false); setInspection(null); setJob(null); setSelected(new Set()); setError(''); setURL(''); setModal(null)
    urlRef.current?.focus()
  }
  function editMetadata() { setDraft({...metadata}); setModal('metadata') }

  return <div className="studio">
    <aside className="sidebar">
      <a className="brand" href="#converter" aria-label="NEXORA Audio"><span className="brand-symbol"><Disc3 size={24}/></span><span>NEXORA<small>audio studio</small></span></a>
      <span className="nav-caption">พื้นที่ทำงาน</span>
      <nav aria-label="เมนูหลัก">
        <a href="#converter" className="nav-item active" aria-current="page"><FileAudio size={18}/>แปลงเสียง<span className="nav-indicator"/></a>
        <a href="#settings" className="nav-item"><SlidersHorizontal size={18}/>ตั้งค่าไฟล์</a>
        <button className="nav-item" onClick={() => setModal('help')}><HelpCircle size={18}/>วิธีใช้งาน</button>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-mark">รูปแบบที่รองรับ</span><p>MP3 · M4A · FLAC</p></div><p className="copyright">NEXORA Audio Studio</p></div>
    </aside>
    <div className="studio-body">
      <header className="topbar"><div className="breadcrumb">เครื่องมือ <span>/</span><strong>แปลงเสียง</strong></div><div className={'connection ' + (online === false ? 'offline' : '')}><i/>{online === null ? 'กำลังเชื่อมต่อ' : online ? 'พร้อมใช้งาน' : 'เชื่อมต่อไม่ได้'}</div></header>
      <main id="converter">
        <div className="page-heading"><div><p className="overline">AUDIO CONVERTER</p><h1>แปลงเสียงจาก YouTube</h1><p>วางลิงก์ เลือกรูปแบบ แล้วดาวน์โหลดไฟล์เสียง</p></div><button className="button secondary help-button" onClick={()=>setModal('help')}><HelpCircle size={16}/>วิธีใช้งาน</button></div>
        <div className="workbench">
          <div className="source-column">
            <section className="panel source-panel" aria-label="ลิงก์ต้นทาง">
              <div className="panel-heading"><div className="heading-label"><span className="step">01</span><h2>เพิ่มลิงก์ของคุณ</h2></div><span className="subtle">วิดีโอ / Playlist</span></div>
              <form onSubmit={handleInspect}>
                <label htmlFor="source-url" className="sr-only">ลิงก์ YouTube</label>
                <div className={'url-input ' + (error ? 'invalid' : '')}><Link2 size={18}/><input ref={urlRef} id="source-url" value={url} onChange={event=>{setURL(event.target.value);setError('')}} placeholder="วางลิงก์ YouTube ที่นี่" disabled={busy || isInspecting} spellCheck={false} autoComplete="url" aria-invalid={Boolean(error)} aria-describedby={error ? 'url-error' : 'url-hint'}/>{url && !busy && !isInspecting && <button type="button" className="icon-button" onClick={()=>{setURL('');urlRef.current?.focus()}} aria-label="ล้างลิงก์"><X size={16}/></button>}</div>
                <div className="source-form-bottom"><p id="url-hint">รองรับ YouTube และ YouTube Music</p><button className="button primary" disabled={!url.trim() || busy || isInspecting}>{isInspecting ? <LoaderCircle size={16} className="spin"/> : null}{isInspecting ? 'กำลังตรวจสอบ' : 'ตรวจสอบลิงก์'}{!isInspecting && <ArrowRight size={16}/>}</button></div>
                {error && <p className="input-error" id="url-error">{error}</p>}
              </form>
            </section>

            <section className="panel preview-panel" aria-label="ข้อมูลคลิป">
              <div className="panel-heading"><div className="heading-label"><h2>{inspection ? 'รายการที่เลือก' : 'ตัวอย่างไฟล์'}</h2></div><span className="preview-label">{inspection?.kind === 'playlist' ? 'PLAYLIST' : 'SOURCE'}</span></div>
              {!inspection ? <div className={'empty-preview ' + (isInspecting ? 'loading' : '')}>
                <div className="record-art" aria-hidden="true"><div className="record-inner">{isInspecting ? <LoaderCircle size={36} className="spin"/> : <FileAudio size={36} strokeWidth={1.3}/>}</div></div>
                <h3>{isInspecting ? 'กำลังอ่านข้อมูลคลิป' : 'ยังไม่มีคลิปที่เลือก'}</h3>
                <p>{isInspecting ? 'ชื่อคลิปและรายการเพลงจะปรากฏที่นี่' : 'วางลิงก์ด้านบนเพื่อดูชื่อคลิป รูปปก และระยะเวลา'}</p>
              </div> : <>
                <div className="media-preview"><div className="media-cover">{inspection.thumbnail ? <img src={inspection.thumbnail} alt="รูปปกคลิป"/> : <Music2 size={36}/>}<span>{formatDuration(inspection.duration)}</span></div><div className="media-copy"><span className="source-chip">{inspection.kind === 'playlist' ? inspection.count + ' เพลง' : 'YouTube'}</span><h3>{inspection.title}</h3><p>{inspection.artist}</p><span className="media-duration"><Clock3 size={13}/>{formatDuration(inspection.duration)}</span></div></div>
                <div className="metadata-summary"><div><strong>ข้อมูลเพลง</strong><p>{metadata.album || 'ชื่อเพลงและศิลปินจาก YouTube'}</p></div><button className="button text-button" disabled={settingsLocked} onClick={editMetadata}><Pencil size={14}/>แก้ไข</button></div>
                {inspection.kind === 'playlist' && <div className="playlist"><div className="playlist-heading"><span>เลือกแล้ว {selected.size} / {inspection.count} เพลง</span><button disabled={settingsLocked} onClick={()=>setSelected(selected.size === inspection.count ? new Set() : new Set(inspection.entries.map(entry=>entry.id)))}>{selected.size === inspection.count ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}</button></div><div className="tracks">{inspection.entries.map((entry,index)=><label key={entry.id + index} className="track"><input type="checkbox" checked={selected.has(entry.id)} disabled={settingsLocked} onChange={()=>toggle(entry.id)}/><span className="track-index">{String(index+1).padStart(2,'0')}</span><span className="track-name"><strong>{entry.title}</strong><small>{entry.artist}</small></span><span className="track-length">{formatDuration(entry.duration)}</span></label>)}</div></div>}
              </>}
            </section>
            <div className="source-footnote"><Check size={14}/><span>ชื่อเพลง ศิลปิน อัลบั้ม และรูปปกจะบันทึกไปกับไฟล์</span></div>
          </div>

          <aside className="output-column" id="settings">
            <section className="panel settings-panel" aria-label="ตั้งค่าผลลัพธ์">
              <div className="panel-heading"><div className="heading-label"><span className="step mint">02</span><h2>ตั้งค่าไฟล์เสียง</h2></div><SlidersHorizontal size={17}/></div>
              <div className="settings-content">
                <div className="field-heading">รูปแบบไฟล์ <span>เลือก 1 รูปแบบ</span></div>
                <div className="formats">{['mp3','m4a','flac'].map(value=><button aria-pressed={format===value} disabled={settingsLocked} key={value} onClick={()=>changeFormat(value)} className={format===value ? 'chosen' : ''}><FileAudio size={20}/><strong>{value.toUpperCase()}</strong><span className="format-check">{format===value && <Check size={10}/>}</span></button>)}</div>
                <p className="format-description">{format==='mp3' ? 'ฟังได้แทบทุกอุปกรณ์ เหมาะกับการใช้งานทั่วไป' : format==='m4a' ? 'ไฟล์กะทัดรัด เหมาะกับมือถือและแอปฟังเพลง' : 'แปลงโดยไม่ลดคุณภาพเพิ่ม ขนาดไฟล์จะใหญ่ขึ้น'}</p>
                <label className="field-heading" htmlFor="quality">คุณภาพเสียง<span>{format==='mp3' && quality===320 ? 'สูงสุด' : format==='flac' ? 'Lossless' : ''}</span></label>
                <div className="select-field"><select id="quality" disabled={settingsLocked} value={quality} onChange={event=>setQuality(Number(event.target.value))}>{qualityOptions[format].map(option=><option key={option.value} value={option.value}>{option.label} · {option.hint}</option>)}</select><ChevronDown size={16}/></div>
                <p className="quality-hint">คุณภาพไฟล์ขึ้นอยู่กับเสียงต้นทาง</p>
                <div className="included"><span className="included-icon"><Check size={15}/></span><div><strong>ข้อมูลเพลงและรูปปก</strong><p>บันทึกให้โดยอัตโนมัติเมื่อมีข้อมูล</p></div></div>
                <div className="output-summary"><div><span>รูปแบบ</span><strong>{format.toUpperCase()}</strong></div><div><span>จำนวน</span><strong>{inspection ? selected.size + ' ไฟล์' : '—'}</strong></div><div><span>ขนาดโดยประมาณ</span><strong>{estimateFileSize(duration,format,quality).replace('ประมาณ ','') || '—'}</strong></div></div>
                {!job || job.status==='failed' ? <>
                  <button className="button primary convert-button" disabled={!inspection || busy || !selected.size || isInspecting} onClick={start}>{isStarting ? <LoaderCircle className="spin" size={18}/> : <ArrowDownToLine size={18}/>} {isStarting ? 'กำลังเริ่มงาน' : job?.status==='failed' ? 'ลองแปลงอีกครั้ง' : 'แปลงไฟล์เสียง'}</button>
                  <p className={'start-hint ' + (job?.status==='failed' ? 'error-text' : '')}>{job?.status==='failed' ? job.error : inspection ? 'ประมวลผลเสร็จแล้วดาวน์โหลดได้ทันที' : 'ตรวจสอบลิงก์ก่อนเริ่มแปลงไฟล์'}</p>
                </> : job.status==='completed' ? <div className="finished-inline"><span><Check size={16}/>ไฟล์พร้อมแล้ว</span><a className="button primary convert-button" href={downloadURL(job.id)} download onClick={()=>notify('ส่งไฟล์ให้เบราว์เซอร์แล้ว ตรวจสอบรายการดาวน์โหลดได้เลย')}><ArrowDownToLine size={17}/>ดาวน์โหลดไฟล์</a><button className="button text-button" onClick={reset}><Plus size={16}/>แปลงไฟล์ใหม่</button></div> : <div className="job-progress" aria-live="polite"><div><span><LoaderCircle className="spin" size={15}/>{job.stage}</span><strong>{Math.round(progress)}%</strong></div><div className="progress-track" role="progressbar" aria-label="ความคืบหน้า" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{width: progress+'%'}}/></div><p>{job.currentTitle || 'กำลังเตรียมข้อมูล'}{job.totalItems>1 && ' · '+job.currentItem+'/'+job.totalItems}</p></div>}
              </div>
            </section>
            <div className="playlist-note"><ListMusic size={19}/><div><strong>ดาวน์โหลด Playlist ได้ด้วย</strong><p>เลือกเฉพาะเพลงที่ต้องการ<br/>หลายเพลงจะรวมเป็นไฟล์ ZIP ให้</p></div></div>
          </aside>
        </div>
        <footer className="page-footer"><span>NEXORA Audio Studio</span><span>ใช้กับสื่อที่คุณมีสิทธิ์ดาวน์โหลด</span></footer>
      </main>
    </div>

    <Toast toast={toast} onDismiss={dismissToast}/>
    {modal==='help' && <Modal title="เริ่มใช้งานใน 3 ขั้นตอน" description="วิดีโอเดี่ยวและ Playlist ใช้วิธีเดียวกัน" onClose={()=>setModal(null)}><ol className="help-steps"><li><span>1</span><div><strong>วางลิงก์ YouTube</strong><p>กดตรวจสอบลิงก์เพื่ออ่านชื่อคลิปและรายการเพลง</p></div></li><li><span>2</span><div><strong>เลือกรูปแบบและคุณภาพ</strong><p>MP3 สูงสุด 320 kbps, M4A หรือ FLAC แก้ชื่อเพลงและอัลบั้มได้ก่อนเริ่ม</p></div></li><li><span>3</span><div><strong>แปลงแล้วดาวน์โหลด</strong><p>ดูความคืบหน้าในหน้าตั้งค่า เมื่อเสร็จจะมีปุ่มดาวน์โหลดไฟล์</p></div></li></ol><div className="modal-actions"><button className="button primary" onClick={()=>setModal(null)}>เข้าใจแล้ว</button></div></Modal>}
    {modal==='metadata' && <Modal title="แก้ไขข้อมูลเพลง" description="ข้อมูลนี้จะแสดงในแอปฟังเพลงของคุณ" onClose={()=>setModal(null)}><form onSubmit={event=>{event.preventDefault();setMetadata({...draft});setModal(null);notify('บันทึกข้อมูลเพลงแล้ว')}}><div className="metadata-fields">{inspection?.kind==='video' && <><label>ชื่อเพลง<input autoFocus required maxLength={100} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><label>ศิลปิน<input maxLength={100} value={draft.artist} onChange={event=>setDraft({...draft,artist:event.target.value})}/></label></>}<label>อัลบั้ม<input autoFocus={inspection?.kind==='playlist'} maxLength={100} value={draft.album} placeholder="ไม่ระบุอัลบั้ม" onChange={event=>setDraft({...draft,album:event.target.value})}/></label></div><div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setModal(null)}>ยกเลิก</button><button className="button primary">บันทึกข้อมูล</button></div></form></Modal>}
    {modal==='complete' && job?.status==='completed' && <Modal title="ไฟล์ของคุณพร้อมแล้ว" description="แปลงเสียงและบันทึกข้อมูลเพลงเรียบร้อย" onClose={()=>setModal(null)}><div className="download-file"><span><FileAudio size={28}/></span><div><strong>{job.filename}</strong><small>{job.totalItems>1 ? job.totalItems+' เพลงในไฟล์ ZIP' : format.toUpperCase()+' · '+(quality ? quality+' kbps' : 'Lossless')}</small></div><span className="download-check"><Check size={16}/></span></div><p className="download-retention">ไฟล์เก็บไว้ชั่วคราวประมาณ 2 ชั่วโมง แนะนำให้ดาวน์โหลดตอนนี้</p><div className="modal-actions"><button className="button secondary" onClick={()=>setModal(null)}>กลับหน้าหลัก</button><a className="button primary" href={downloadURL(job.id)} download onClick={()=>{setModal(null);notify('ส่งไฟล์ให้เบราว์เซอร์แล้ว ตรวจสอบรายการดาวน์โหลดได้เลย')}}><ArrowDownToLine size={17}/>ดาวน์โหลด</a></div></Modal>}
  </div>
}
