'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Display, Media, PlaylistItem } from '@/lib/types'
import {
  logoutAction, createDisplayAction, updateDisplayAction, deleteDisplayAction,
  updateNotesAction, toggleActiveAction, getUploadUrlAction, registerMediaAction, deleteMediaAction,
  addToPlaylistAction, removeFromPlaylistAction, updatePlaylistItemAction,
  reorderPlaylistAction, publishPlaylistAction,
  sendDisplayCommand, updateScheduleAction,
} from '@/app/actions'

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL!

function mediaUrl(displayId: string, filename: string) {
  return `${R2_PUBLIC_URL}/${displayId}/${filename}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --- Modal ---
function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#ffffff] border border-[#f5c7b8] rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-[#2d1b17] mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// --- DisplayForm ---
function DisplayForm({ initial, onSave, onCancel }: {
  initial?: Partial<Display>
  onSave: (name: string, width: number, height: number) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [width, setWidth] = useState(initial?.width ?? 1920)
  const [height, setHeight] = useState(initial?.height ?? 1080)
  const [saving, setSaving] = useState(false)

  async function handle() {
    if (!name.trim()) return
    setSaving(true)
    await onSave(name.trim(), width, height)
    setSaving(false)
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-[#8a6a60] mb-1">Nome display</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="w-full bg-[#ffffff] border border-[#f5c7b8] rounded-lg px-3 py-2 text-[#2d1b17] text-sm outline-none focus:border-[#ad6f62]"
          placeholder="es. Vetrina ingresso" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm text-[#8a6a60] mb-1">Larghezza</label>
          <input type="number" value={width} onChange={e => setWidth(Number(e.target.value))}
            className="w-full bg-[#ffffff] border border-[#f5c7b8] rounded-lg px-3 py-2 text-[#2d1b17] text-sm outline-none focus:border-[#ad6f62]" />
        </div>
        <div className="flex-1">
          <label className="block text-sm text-[#8a6a60] mb-1">Altezza</label>
          <input type="number" value={height} onChange={e => setHeight(Number(e.target.value))}
            className="w-full bg-[#ffffff] border border-[#f5c7b8] rounded-lg px-3 py-2 text-[#2d1b17] text-sm outline-none focus:border-[#ad6f62]" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={handle} disabled={saving || !name.trim()}
          className="flex-1 bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
          {saving ? 'Salvo...' : 'Salva'}
        </button>
        <button onClick={onCancel}
          className="flex-1 bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg py-2 text-sm transition-colors">
          Annulla
        </button>
      </div>
    </div>
  )
}

// --- UploadItem ---
interface UploadProgress { name: string; progress: number; done: boolean; error?: string }

// --- LedWallControl ---
function isAgentOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < 120_000 // 2 minutes
}

function LedWallControl({ display, onLocalUpdate }: {
  display: Display
  onLocalUpdate: (patch: Partial<Display>) => void
}) {
  const [brightness, setBrightness] = useState(display.brightness ?? 80)
  const [savingBrightness, setSavingBrightness] = useState(false)
  const [scheduleOn, setScheduleOn] = useState(display.schedule_on?.slice(0, 5) ?? '')
  const [scheduleOff, setScheduleOff] = useState(display.schedule_off?.slice(0, 5) ?? '')
  const [scheduleEnabled, setScheduleEnabled] = useState(display.schedule_enabled ?? false)
  const [savingSchedule, setSavingSchedule] = useState(false)

  // Re-sync local state when a different display is selected
  useEffect(() => {
    setBrightness(display.brightness ?? 80)
    setScheduleOn(display.schedule_on?.slice(0, 5) ?? '')
    setScheduleOff(display.schedule_off?.slice(0, 5) ?? '')
    setScheduleEnabled(display.schedule_enabled ?? false)
  }, [display.id, display.brightness, display.schedule_on, display.schedule_off, display.schedule_enabled])

  const isOn = display.power_state === 'on'
  const agentOnline = isAgentOnline(display.agent_last_seen)
  const hasSignal = display.has_signal

  async function togglePower() {
    const next = isOn ? 'power_off' : 'power_on'
    onLocalUpdate({ power_state: isOn ? 'off' : 'on' })
    await sendDisplayCommand(display.id, next)
  }

  async function commitBrightness(value: number) {
    setSavingBrightness(true)
    onLocalUpdate({ brightness: value })
    await sendDisplayCommand(display.id, 'set_brightness', { brightness: value })
    setSavingBrightness(false)
  }

  async function saveSchedule() {
    setSavingSchedule(true)
    const payload = {
      schedule_on: scheduleOn || null,
      schedule_off: scheduleOff || null,
      schedule_enabled: scheduleEnabled,
    }
    onLocalUpdate(payload)
    await updateScheduleAction(display.id, payload)
    setSavingSchedule(false)
  }

  return (
    <div className="bg-white border border-[#f5c7b8] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#2d1b17] uppercase tracking-wider">Controllo LED wall</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${agentOnline ? 'bg-[#22c55e]' : 'bg-[#e8cfc6]'}`} />
            <span className={agentOnline ? 'text-[#22c55e]' : 'text-[#b09890]'}>
              {agentOnline ? 'Agent online' : 'Agent offline'}
            </span>
          </span>
          {agentOnline && (
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${hasSignal ? 'bg-[#22c55e]' : 'bg-[#dc2626]'}`} />
              <span className={hasSignal ? 'text-[#22c55e]' : 'text-[#dc2626]'}>
                {hasSignal ? 'Segnale HDMI' : 'No segnale'}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Power toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[#2d1b17] font-medium">Alimentazione</p>
          <p className="text-xs text-[#b09890]">{isOn ? 'LED wall acceso' : 'LED wall spento'}</p>
        </div>
        <button
          onClick={togglePower}
          className={`relative w-14 h-8 rounded-full transition-colors ${isOn ? 'bg-[#ad6f62]' : 'bg-[#e8cfc6]'}`}
          aria-label="Toggle alimentazione"
        >
          <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${isOn ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Brightness slider */}
      <div className={isOn ? '' : 'opacity-50 pointer-events-none'}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-[#2d1b17] font-medium">Luminosità</p>
          <span className="text-sm text-[#ad6f62] font-medium tabular-nums">
            {brightness}%{savingBrightness && ' …'}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={brightness}
          onChange={e => setBrightness(Number(e.target.value))}
          onMouseUp={e => commitBrightness(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={e => commitBrightness(Number((e.target as HTMLInputElement).value))}
          className="w-full accent-[#ad6f62]"
          disabled={!isOn}
        />
      </div>

      {/* Schedule */}
      <div className="border-t border-[#f5c7b8] pt-4 space-y-3">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="text-sm text-[#2d1b17] font-medium">Programmazione automatica</p>
            <p className="text-xs text-[#b09890]">Accende e spegne agli orari indicati</p>
          </div>
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={e => setScheduleEnabled(e.target.checked)}
            className="w-4 h-4 accent-[#ad6f62]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#8a6a60] mb-1">Accensione</label>
            <input
              type="time"
              value={scheduleOn}
              onChange={e => setScheduleOn(e.target.value)}
              className="w-full bg-white border border-[#f5c7b8] rounded-lg px-3 py-2 text-sm text-[#2d1b17] outline-none focus:border-[#ad6f62]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#8a6a60] mb-1">Spegnimento</label>
            <input
              type="time"
              value={scheduleOff}
              onChange={e => setScheduleOff(e.target.value)}
              className="w-full bg-white border border-[#f5c7b8] rounded-lg px-3 py-2 text-sm text-[#2d1b17] outline-none focus:border-[#ad6f62]"
            />
          </div>
        </div>

        <button
          onClick={saveSchedule}
          disabled={savingSchedule}
          className="w-full bg-[#ad6f62] hover:bg-[#8f5648] disabled:opacity-50 text-[#f5c7b8] font-medium rounded-lg py-2 text-sm transition-colors"
        >
          {savingSchedule ? 'Salvo...' : 'Salva programmazione'}
        </button>
      </div>

      {display.agent_last_seen && (
        <p className="text-[10px] text-[#b09890] text-center">
          Ultimo heartbeat: {new Date(display.agent_last_seen).toLocaleString('it-IT')}
        </p>
      )}
    </div>
  )
}

// --- Main AdminDashboard ---
export default function AdminDashboard({ initialDisplays }: { initialDisplays: Display[] }) {
  const router = useRouter()
  const supabase = createClient()

  const [displays, setDisplays] = useState<Display[]>(initialDisplays)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [media, setMedia] = useState<Media[]>([])
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([])
  const [published, setPublished] = useState<PlaylistItem[]>([])

  const [showNewDisplay, setShowNewDisplay] = useState(false)
  const [editingDisplay, setEditingDisplay] = useState<Display | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Display | null>(null)

  const [uploads, setUploads] = useState<UploadProgress[]>([])
  const [dragging, setDragging] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const notesRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selected = displays.find(d => d.id === selectedId) ?? null

  const displayUrl = selectedId
    ? (typeof window !== 'undefined' ? `${window.location.origin}/display/${selectedId}` : `/display/${selectedId}`)
    : ''

  // Load data for selected display
  const loadDisplayData = useCallback(async (displayId: string) => {
    const [{ data: m }, { data: pl }, { data: pub }] = await Promise.all([
      supabase.from('media').select('*').eq('display_id', displayId).order('uploaded_at'),
      supabase.from('playlist_items').select('*, media(*)').eq('display_id', displayId).order('position'),
      supabase.from('published_items').select('*, media(*)').eq('display_id', displayId).order('position'),
    ])
    setMedia((m as Media[]) ?? [])
    setPlaylist((pl as PlaylistItem[]) ?? [])
    setPublished((pub as PlaylistItem[]) ?? [])
  }, [supabase])

  useEffect(() => {
    if (!selectedId) return
    loadDisplayData(selectedId)
  }, [selectedId, loadDisplayData])

  // Realtime: displays
  useEffect(() => {
    const ch = supabase.channel('displays-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'displays' }, () => {
        supabase.from('displays').select('*').order('created_at').then(({ data }) => {
          if (data) setDisplays(data as Display[])
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase])

  // Realtime: playlist & media for selected display
  useEffect(() => {
    if (!selectedId) return
    const ch = supabase.channel(`display-data-${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist_items', filter: `display_id=eq.${selectedId}` }, () => loadDisplayData(selectedId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'published_items', filter: `display_id=eq.${selectedId}` }, () => loadDisplayData(selectedId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media', filter: `display_id=eq.${selectedId}` }, () => loadDisplayData(selectedId))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [selectedId, supabase, loadDisplayData])

  const playlistChanged = JSON.stringify(playlist.map(i => ({ id: i.media_id, pos: i.position, dur: i.duration, bg: i.bg_color }))) !==
    JSON.stringify(published.map(i => ({ id: i.media_id, pos: i.position, dur: i.duration, bg: i.bg_color })))

  // Notes debounce
  function handleNotesChange(notes: string) {
    if (!selectedId) return
    setDisplays(prev => prev.map(d => d.id === selectedId ? { ...d, notes } : d))
    if (notesRef.current) clearTimeout(notesRef.current)
    notesRef.current = setTimeout(() => updateNotesAction(selectedId, notes), 800)
  }

  // Upload
  async function handleFiles(files: File[]) {
    if (!selectedId) return

    const valid = files.filter(f => {
      const isVideo = f.type.startsWith('video/')
      const isPhoto = f.type.startsWith('image/')
      if (isVideo && f.size > 5 * 1024 * 1024 * 1024) return false
      if (isPhoto && f.size > 50 * 1024 * 1024) return false
      return isVideo || isPhoto
    })

    for (const file of valid) {
      const mediaId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const ext = file.name.split('.').pop() ?? ''
      const filename = `${mediaId}.${ext}`
      const key = `${selectedId}/${filename}`

      setUploads(prev => [...prev, { name: file.name, progress: 0, done: false }])

      const { error: urlErr, url } = await getUploadUrlAction(key, file.type)
      if (urlErr || !url) {
        setUploads(prev => prev.map(u => u.name === file.name ? { ...u, error: urlErr ?? 'URL non disponibile', done: true } : u))
        continue
      }

      const upErr = await new Promise<string | null>(resolve => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', file.type)
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100)
            setUploads(prev => prev.map(u => u.name === file.name ? { ...u, progress } : u))
          }
        }
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? null : `Upload fallito (${xhr.status})`)
        xhr.onerror = () => resolve('Errore di rete durante upload')
        xhr.send(file)
      })

      if (upErr) {
        setUploads(prev => prev.map(u => u.name === file.name ? { ...u, error: upErr, done: true } : u))
        continue
      }

      const type: 'video' | 'photo' = file.type.startsWith('video/') ? 'video' : 'photo'
      await registerMediaAction({
        displayId: selectedId,
        filename,
        originalName: file.name,
        type,
        size: file.size,
        contentType: file.type,
      })

      setUploads(prev => prev.map(u => u.name === file.name ? { ...u, progress: 100, done: true } : u))
    }

    setTimeout(() => setUploads(prev => prev.filter(u => !u.done || u.error)), 3000)
    loadDisplayData(selectedId)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  async function handleLogout() {
    await logoutAction()
    router.push('/admin/login')
  }

  const inPlaylist = (mediaId: string) => playlist.some(p => p.media_id === mediaId)

  function selectDisplay(id: string) {
    setSelectedId(id)
    setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen bg-[#ffffff] overflow-hidden">
      {/* Mobile backdrop */}
      <div
        onClick={() => setSidebarOpen(false)}
        className={`md:hidden fixed inset-0 bg-black/30 z-30 transition-opacity ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Sidebar (drawer on mobile, static on desktop) */}
      <aside className={`
        fixed md:static inset-y-0 left-0 w-64 flex-shrink-0 bg-[#ffffff] border-r border-[#f5c7b8] flex flex-col z-40
        transition-transform md:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="bg-white px-4 py-5 flex flex-col items-center border-b border-[#f5c7b8] relative">
          <div className="logo-dark" style={{ width: '160px', height: '40px' }} />
          <p className="text-[11px] text-[#ad6f62] mt-1.5 tracking-wide">Display Manager</p>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden absolute top-3 right-3 text-[#ad6f62] p-1"
            aria-label="Chiudi menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {displays.length === 0 && (
            <p className="text-xs text-[#b09890] px-2 py-3">Nessun display</p>
          )}
          {displays.map(d => (
            <button key={d.id} onClick={() => selectDisplay(d.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors group ${
                selectedId === d.id
                  ? 'bg-[rgba(173,111,98,0.12)] border border-[rgba(173,111,98,0.2)]'
                  : 'hover:bg-[#ffffff] border border-transparent'
              }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${d.active ? 'bg-[#22c55e]' : 'bg-[#e8cfc6]'}`} />
                <span className="text-sm text-[#2d1b17] truncate">{d.name}</span>
              </div>
              <p className="text-xs text-[#b09890] mt-0.5 ml-4">{d.width}×{d.height}</p>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[#f5c7b8] space-y-1.5">
          <button onClick={() => setShowNewDisplay(true)}
            className="w-full bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg py-2 text-sm font-medium transition-colors">
            + Nuovo Display
          </button>
          <button onClick={handleLogout}
            className="w-full bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg py-2 text-sm transition-colors">
            Esci
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden h-14 bg-white border-b border-[#f5c7b8] flex items-center px-4 gap-3 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-[#ad6f62]"
            aria-label="Apri menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div className="logo-dark" style={{ width: '130px', height: '28px' }} />
          {selected && <span className="ml-auto text-sm text-[#8a6a60] truncate max-w-[40%]">{selected.name}</span>}
        </div>

        <main className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-[#b09890] px-6 text-center">
            Seleziona un display dal menu
          </div>
        ) : (
          <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 md:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#2d1b17]">{selected.name}</h2>
                <p className="text-sm text-[#8a6a60] mt-0.5">{selected.width}×{selected.height}</p>
              </div>
              <div className="flex gap-2 flex-wrap sm:flex-shrink-0">
                <a href={`/display/${selected.id}`} target="_blank"
                  className="bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg px-3 py-1.5 text-sm transition-colors">
                  Apri Display ↗
                </a>
                <button onClick={() => setEditingDisplay(selected)}
                  className="bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg px-3 py-1.5 text-sm transition-colors">
                  Modifica
                </button>
                <button onClick={() => setDeleteConfirm(selected)}
                  className="bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg px-3 py-1.5 text-sm transition-colors">
                  Elimina
                </button>
              </div>
            </div>

            {/* Link + Status */}
            <div className="bg-[#ffffff] border border-[#f5c7b8] rounded-xl p-4 space-y-3">
              {/* Copyable link */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#b09890] flex-shrink-0">Link display:</span>
                <code className="flex-1 text-xs text-[#8a6a60] bg-[#ffffff] rounded px-2 py-1 truncate">{displayUrl}</code>
                <button onClick={() => navigator.clipboard.writeText(displayUrl)}
                  className="text-xs text-[#ad6f62] hover:text-[#c4897c] flex-shrink-0 transition-colors">
                  Copia
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${selected.active ? 'bg-[#22c55e] shadow-[0_0_6px_#22c55e]' : 'bg-[#e8cfc6]'}`} />
                  <span className={`text-sm font-medium ${selected.active ? 'text-[#22c55e]' : 'text-[#b09890]'}`}>
                    {selected.active ? 'Attivo' : 'Non attivo'}
                  </span>
                </div>
                {selected.active && (
                  <button onClick={async () => {
                    await toggleActiveAction(selected.id, false)
                    setDisplays(prev => prev.map(d => d.id === selected.id ? { ...d, active: false } : d))
                  }}
                    className="bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg px-3 py-1 text-xs transition-colors">
                    Ferma
                  </button>
                )}
              </div>
            </div>

            {/* Controllo LED wall */}
            <LedWallControl
              display={selected}
              onLocalUpdate={patch => setDisplays(prev => prev.map(d => d.id === selected.id ? { ...d, ...patch } : d))}
            />

            {/* Notes */}
            <div className="bg-[#ffffff] border border-[#f5c7b8] rounded-xl p-4">
              <label className="block text-xs text-[#b09890] uppercase tracking-wider mb-2">Note negozio</label>
              <textarea
                value={selected.notes ?? ''}
                onChange={e => handleNotesChange(e.target.value)}
                rows={2}
                placeholder="Note interne sul display..."
                className="w-full bg-[#ffffff] border border-[#f5c7b8] rounded-lg px-3 py-2 text-sm text-[#2d1b17] outline-none focus:border-[#ad6f62] resize-none transition-colors placeholder:text-[#b09890]"
              />
            </div>

            {/* Playlist */}
            <div className="bg-[#ffffff] border border-[#f5c7b8] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#2d1b17] uppercase tracking-wider">Scaletta</h3>
                {playlistChanged && (
                  <button onClick={async () => {
                    await publishPlaylistAction(selected.id)
                    await loadDisplayData(selected.id)
                  }}
                    className="bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
                    Pubblica scaletta
                  </button>
                )}
              </div>

              {playlist.length === 0 ? (
                <p className="text-sm text-[#b09890] py-2">Nessun contenuto in scaletta. Aggiungili dalla libreria.</p>
              ) : (
                <div className="space-y-2">
                  {playlist.map((item, idx) => {
                    const m = item.media as unknown as Media
                    return (
                      <div key={item.id} className="flex items-center gap-3 bg-[#ffffff] border border-[#f5c7b8] rounded-lg p-2.5">
                        {/* Thumbnail */}
                        <div className="w-12 h-9 rounded overflow-hidden bg-[#ffffff] flex-shrink-0">
                          {m?.type === 'photo' ? (
                            <img src={mediaUrl(selected.id, m.filename)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[#b09890]">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#2d1b17] truncate">{m?.original_name ?? 'Media'}</p>
                          <p className="text-xs text-[#b09890]">{m?.type === 'video' ? 'Video' : 'Foto'}</p>
                        </div>

                        {/* Photo controls */}
                        {m?.type === 'photo' && (
                          <div className="flex items-center gap-2">
                            <input type="number" min={1} max={300} value={item.duration}
                              onChange={async e => {
                                const v = Number(e.target.value)
                                await updatePlaylistItemAction(item.id, { duration: v })
                                setPlaylist(prev => prev.map(p => p.id === item.id ? { ...p, duration: v } : p))
                              }}
                              className="w-14 bg-[#ffffff] border border-[#f5c7b8] rounded px-2 py-1 text-xs text-[#2d1b17] outline-none focus:border-[#ad6f62] text-center" />
                            <span className="text-xs text-[#b09890]">sec</span>
                            <input type="color" value={item.bg_color}
                              onChange={async e => {
                                const v = e.target.value
                                await updatePlaylistItemAction(item.id, { bg_color: v })
                                setPlaylist(prev => prev.map(p => p.id === item.id ? { ...p, bg_color: v } : p))
                              }}
                              title="Colore sfondo" />
                          </div>
                        )}

                        {/* Reorder */}
                        <div className="flex flex-col gap-0.5">
                          <button onClick={async () => {
                            await reorderPlaylistAction(item.id, 'up', selected.id)
                            await loadDisplayData(selected.id)
                          }} disabled={idx === 0}
                            className="text-[#b09890] hover:text-[#8a6a60] disabled:opacity-20 text-xs leading-none p-0.5 transition-colors">▲</button>
                          <button onClick={async () => {
                            await reorderPlaylistAction(item.id, 'down', selected.id)
                            await loadDisplayData(selected.id)
                          }} disabled={idx === playlist.length - 1}
                            className="text-[#b09890] hover:text-[#8a6a60] disabled:opacity-20 text-xs leading-none p-0.5 transition-colors">▼</button>
                        </div>

                        {/* Remove */}
                        <button onClick={async () => {
                          await removeFromPlaylistAction(item.id)
                          setPlaylist(prev => prev.filter(p => p.id !== item.id))
                        }}
                          className="text-[#b09890] hover:text-[#dc2626] transition-colors ml-1">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Media Library */}
            <div className="bg-[#ffffff] border border-[#f5c7b8] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#2d1b17] uppercase tracking-wider mb-3">Libreria Media</h3>

              {/* Upload area */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-4 ${
                  dragging ? 'border-[#ad6f62] bg-[rgba(173,111,98,0.05)]' : 'border-[#f5c7b8] hover:border-[#e8cfc6]'
                }`}>
                <p className="text-sm text-[#8a6a60]">Trascina qui i file o <span className="text-[#ad6f62]">sfoglia</span></p>
                <p className="text-xs text-[#b09890] mt-1">Video (.mp4 .mov .webm) max 5GB · Foto (.jpg .png .webp) max 50MB</p>
                <input ref={fileInputRef} type="file" multiple accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                  className="hidden" onChange={e => { if (e.target.files) handleFiles(Array.from(e.target.files)) }} />
              </div>

              {/* Upload progress */}
              {uploads.length > 0 && (
                <div className="space-y-2 mb-4">
                  {uploads.map((u, i) => (
                    <div key={i} className="bg-[#ffffff] border border-[#f5c7b8] rounded-lg p-2.5">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="text-[#8a6a60] truncate">{u.name}</span>
                        <span className={u.error ? 'text-[#dc2626]' : 'text-[#22c55e]'}>
                          {u.error ? 'Errore' : u.done ? 'Completato' : `${u.progress}%`}
                        </span>
                      </div>
                      {u.error && (
                        <p className="text-[10px] text-[#dc2626] mt-1 break-words">{u.error}</p>
                      )}
                      {!u.error && (
                        <div className="h-1 bg-[#f5c7b8] rounded-full overflow-hidden">
                          <div className="h-full bg-[#ad6f62] transition-all" style={{ width: `${u.progress}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Media grid */}
              {media.length === 0 ? (
                <p className="text-sm text-[#b09890]">Nessun media caricato</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {media.map(m => (
                    <div key={m.id} className="bg-[#ffffff] border border-[#f5c7b8] rounded-xl overflow-hidden group">
                      <div className="aspect-video bg-[#ffffff] relative">
                        {m.type === 'photo' ? (
                          <img src={mediaUrl(selected.id, m.filename)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <video src={mediaUrl(selected.id, m.filename)} className="w-full h-full object-cover" muted preload="metadata" playsInline />
                        )}
                        <div className="absolute top-1.5 left-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            m.type === 'video' ? 'bg-[rgba(173,111,98,0.9)] text-white' : 'bg-[rgba(34,197,94,0.8)] text-white'
                          }`}>{m.type === 'video' ? 'VID' : 'IMG'}</span>
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-xs text-[#8a6a60] truncate" title={m.original_name}>{m.original_name}</p>
                        <p className="text-[10px] text-[#b09890] mt-0.5">{formatBytes(m.size)}</p>
                        <div className="flex gap-1.5 mt-2">
                          {inPlaylist(m.id) ? (
                            <button onClick={async () => {
                              const item = playlist.find(p => p.media_id === m.id)
                              if (item) {
                                await removeFromPlaylistAction(item.id)
                                setPlaylist(prev => prev.filter(p => p.id !== item.id))
                              }
                            }}
                              className="flex-1 text-[10px] bg-[rgba(173,111,98,0.12)] border border-[rgba(173,111,98,0.2)] text-[#ad6f62] rounded py-1 transition-colors hover:bg-[rgba(173,111,98,0.2)]">
                              Rimuovi
                            </button>
                          ) : (
                            <button onClick={async () => {
                              await addToPlaylistAction(selected.id, m.id)
                              await loadDisplayData(selected.id)
                            }}
                              className="flex-1 text-[10px] bg-[#ffffff] border border-[#f5c7b8] text-[#8a6a60] rounded py-1 transition-colors hover:text-[#2d1b17] hover:border-[#e8cfc6]">
                              + Scaletta
                            </button>
                          )}
                          <button onClick={async () => {
                            if (!confirm(`Eliminare "${m.original_name}"?`)) return
                            await deleteMediaAction(m.id, selected.id, m.filename)
                            setMedia(prev => prev.filter(x => x.id !== m.id))
                            setPlaylist(prev => prev.filter(x => x.media_id !== m.id))
                          }}
                            className="text-[10px] bg-[rgba(220,38,38,0.08)] border border-[rgba(220,38,38,0.15)] text-[#dc2626] rounded py-1 px-2 transition-colors hover:bg-[rgba(220,38,38,0.15)]">
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        </main>
      </div>

      {/* Modals */}
      <Modal open={showNewDisplay} onClose={() => setShowNewDisplay(false)} title="Nuovo Display">
        <DisplayForm
          onSave={async (name, width, height) => {
            const res = await createDisplayAction(name, width, height)
            if (!res.error) setShowNewDisplay(false)
          }}
          onCancel={() => setShowNewDisplay(false)}
        />
      </Modal>

      <Modal open={!!editingDisplay} onClose={() => setEditingDisplay(null)} title="Modifica Display">
        {editingDisplay && (
          <DisplayForm
            initial={editingDisplay}
            onSave={async (name, width, height) => {
              await updateDisplayAction(editingDisplay.id, { name, width, height })
              setDisplays(prev => prev.map(d => d.id === editingDisplay.id ? { ...d, name, width, height } : d))
              setEditingDisplay(null)
            }}
            onCancel={() => setEditingDisplay(null)}
          />
        )}
      </Modal>

      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Elimina Display">
        {deleteConfirm && (
          <div className="space-y-4">
            <p className="text-sm text-[#8a6a60]">
              Eliminare <strong className="text-[#2d1b17]">{deleteConfirm.name}</strong>? Tutti i media associati verranno eliminati definitivamente.
            </p>
            <div className="flex gap-2">
              <button onClick={async () => {
                await deleteDisplayAction(deleteConfirm.id)
                setDisplays(prev => prev.filter(d => d.id !== deleteConfirm.id))
                if (selectedId === deleteConfirm.id) setSelectedId(null)
                setDeleteConfirm(null)
              }}
                className="flex-1 bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg py-2 text-sm font-medium transition-colors">
                Elimina
              </button>
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-[#ad6f62] hover:bg-[#8f5648] text-[#f5c7b8] rounded-lg py-2 text-sm transition-colors">
                Annulla
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
