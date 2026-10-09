export type Media = {
  id: string
  url: string
  title: string
  artist: string
  album?: string
  thumbnail: string
  duration: number
}

export type Inspection = {
  kind: 'video' | 'playlist'
  title: string
  artist: string
  thumbnail: string
  duration: number
  count: number
  entries: Media[]
}

export type Job = {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage: string
  progress: number
  currentItem: number
  totalItems: number
  currentTitle?: string
  error?: string
  filename?: string
}

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, options)
  const data = (await response.json().catch(() => null)) as T | { error?: string } | null
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? data.error : undefined
    throw new Error(message || 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้')
  }
  return data as T
}

export async function inspectMedia(url: string, signal?: AbortSignal) {
  return request<Inspection>('/api/media/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  })
}

export async function createJob(payload: {
  url: string
  format: string
  quality: number
  title?: string
  artist?: string
  album?: string
  tracks?: string[]
}) {
  return request<Job>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function getJob(id: string) {
  return request<Job>(`/api/jobs/${encodeURIComponent(id)}`)
}

export async function getHealth() {
  return request<{ status: string }>('/health')
}

export function downloadURL(id: string) {
  return `${apiBase}/api/jobs/${encodeURIComponent(id)}/download`
}
