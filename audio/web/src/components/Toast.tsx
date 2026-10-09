import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleAlert, X } from 'lucide-react'

export type ToastMessage = { id: number; message: string; kind: 'success' | 'error' }

export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(onDismiss, toast.kind === 'error' ? 9000 : 5000)
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])
  return createPortal(<div className="toast-region" aria-live="polite" aria-atomic="true">{toast && <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}>
    <span className="toast-icon">{toast.kind === 'success' ? <Check size={18} /> : <CircleAlert size={18} />}</span><p>{toast.message}</p><button className="icon-button" onClick={onDismiss} aria-label="ปิดการแจ้งเตือน"><X size={18} /></button>
  </div>}</div>, document.body)
}
