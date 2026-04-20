'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Display, Media, PlaylistItem } from '@/lib/types'
import {
  logoutAction, createDisplayAction, updateDisplayAction, deleteDisplayAction,
  updateNotesAction, toggleActiveAction, registerMediaAction, deleteMediaAction,
  addToPlaylistAction, removeFromPlaylistAction, updatePlaylistItemAction,
  reorderPlaylistAction, publishPlaylistAction,
} from '@/app/actions'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

function mediaUrl(displayId: string, filename: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/media/${displayId}/${filename}`
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
      <div className="relative bg-[#131313] border border-[#232323] rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-[#e8e8e8] mb-4">{title}</h2>
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
        <label className="block text-sm text-[#888] mb-1">Nome display</label>
        <input value={name} onChange={e => setName(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#232323] rounded-lg px-3 py-2 text-[#e8e8e8] text-sm outline-none focus:border-[#3b82f6]"
          placeholder="es. Vetrina ingresso" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm text-[#888] mb-1">Larghezza</label>
          <input type="number" value={width} onChange={e => setWidth(Number(e.target.value))}
            className="w-full bg-[#0a0a0a] border border-[#232323] rounded-lg px-3 py-2 text-[#e8e8e8] text-sm outline-none focus:border-[#3b82f6]" />
        </div>
        <div className="flex-1">
          <label className="block text-sm text-[#888] mb-1">Altezza</label>
          <input type="number" value={height} onChange={e => setHeight(Number(e.target.value))}
            className="w-full bg-[#0a0a0a] border border-[#232323] rounded-lg px-3 py-2 text-[#e8e8e8] text-sm outline-none focus:border-[#3b82f6]" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button onClick={handle} disabled={saving || !name.trim()}
          className="flex-1 bg-[rgba(59,130,246,0.12)] hover:bg-[rgba(59,130,246,0.2)] border border-[rgba(59,130,246,0.2)] text-[#3b82f6] rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
          {saving ? 'Salvo...' : 'Salva'}
        </button>
        <button onClick={onCancel}
          className="flex-1 bg-[#1a1a1a] hover:bg-[#232323] border border-[#232323] text-[#888] rounded-lg py-2 text-sm transition-colors">
          Annulla
        </button>
      </div>
    </div>
  )
}

// --- UploadItem ---
interface UploadProgress { name: string; progress: number; done: boolean; error?: string }

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
      if (isVideo && f.size > 500 * 1024 * 1024) return false
      if (isPhoto && f.size > 20 * 1024 * 1024) return false
      return isVideo || isPhoto
    })

    for (const file of valid) {
      const mediaId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const ext = file.name.split('.').pop() ?? ''
      const filename = `${mediaId}.${ext}`
      const path = `${selectedId}/${filename}`

      setUploads(prev => [...prev, { name: file.name, progress: 0, done: false }])

      const { error: upErr } = await supabase.storage.from('media').upload(path, file, {
        contentType: file.type,
        upsert: false,
      })

      if (upErr) {
        setUploads(prev => prev.map(u => u.name === file.name ? { ...u, error: upErr.message, done: true } : u))
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

    // Clear completed after 3s
    setTimeout(() => setUploads(prev => prev.filter(u => !u.done)), 3000)
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

  return (
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-[#131313] border-r border-[#232323] flex flex-col">
        <div className="p-4 border-b border-[#232323]">
          <h1 className="text-base font-semibold text-[#e8e8e8]">Loveskin Display</h1>
          <p className="text-xs text-[#555] mt-0.5">Display Manager</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {displays.length === 0 && (
            <p className="text-xs text-[#555] px-2 py-3">Nessun display</p>
          )}
          {displays.map(d => (
            <button key={d.id} onClick={() => setSelectedId(d.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors group ${
                selectedId === d.id
                  ? 'bg-[rgba(59,130,246,0.12)] border border-[rgba(59,130,246,0.2)]'
                  : 'hover:bg-[#1a1a1a] border border-transparent'
              }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${d.active ? 'bg-[#22c55e]' : 'bg-[#333]'}`} />
                <span className="text-sm text-[#e8e8e8] truncate">{d.name}</span>
              </div>
              <p className="text-xs text-[#555] mt-0.5 ml-4">{d.width}×{d.height}</p>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[#232323] space-y-1.5">
          <button onClick={() => setShowNewDisplay(true)}
            className="w-full bg-[rgba(59,130,246,0.12)] hover:bg-[rgba(59,130,246,0.2)] border border-[rgba(59,130,246,0.2)] text-[#3b82f6] rounded-lg py-2 text-sm font-medium transition-colors">
            + Nuovo Display
          </button>
          <button onClick={handleLogout}
            className="w-full bg-[#1a1a1a] hover:bg-[#232323] border border-[#232323] text-[#888] rounded-lg py-2 text-sm transition-colors">
            Esci
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-[#555]">
            Seleziona un display dalla sidebar
          </div>
        ) : (
          <div className="p-6 max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#e8e8e8]">{selected.name}</h2>
                <p className="text-sm text-[#888] mt-0.5">{selected.width}×{selected.height}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <a href={`/display/${selected.id}`} target="_blank"
                  className="bg-[#1a1a1a] hover:bg-[#232323] border border-[#232323] text-[#888] rounded-lg px-3 py-1.5 text-sm transition-colors">
                  Apri Display ↗
                </a>
                <button onClick={() => setEditingDisplay(selected)}
                  className="bg-[#1a1a1a] hover:bg-[#232323] border border-[#232323] text-[#888] rounded-lg px-3 py-1.5 text-sm transition-colors">
                  Modifica
                </button>
                <button onClick={() => setDeleteConfirm(selected)}
                  className="bg-[rgba(239,68,68,0.08)] hover:bg-[rgba(239,68,68,0.15)] border border-[rgba(239,68,68,0.2)] text-[#ef4444] rounded-lg px-3 py-1.5 text-sm transition-colors">
                  Elimina
                </button>
              </div>
            </div>

            {/* Link + Status */}
            <div className="bg-[#131313] border border-[#232323] rounded-xl p-4 space-y-3">
              {/* Copyable link */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#555] flex-shrink-0">Link display:</span>
                <code className="flex-1 text-xs text-[#888] bg-[#0a0a0a] rounded px-2 py-1 truncate">{displayUrl}</code>
                <button onClick={() => navigator.clipboard.writeText(displayUrl)}
                  className="text-xs text-[#3b82f6] hover:text-[#60a5fa] flex-shrink-0 transition-colors">
                  Copia
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${selected.active ? 'bg-[#22c55e] shadow-[0_0_6px_#22c55e]' : 'bg-[#333]'}`} />
                  <span className={`text-sm font-medium ${selected.active ? 'text-[#22c55e]' : 'text-[#555]'}`}>
                    {selected.active ? 'Attivo' : 'Non attivo'}
                  </span>
                </div>
                {selected.active && (
                  <button onClick={async () => {
                    await toggleActiveAction(selected.id, false)
                    setDisplays(prev => prev.map(d => d.id === selected.id ? { ...d, active: false } : d))
                  }}
                    className="bg-[rgba(239,68,68,0.08)] hover:bg-[rgba(239,68,68,0.15)] border border-[rgba(239,68,68,0.2)] text-[#ef4444] rounded-lg px-3 py-1 text-xs transition-colors">
                    Ferma
                  </button>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-[#131313] border border-[#232323] rounded-xl p-4">
              <label className="block text-xs text-[#555] uppercase tracking-wider mb-2">Note negozio</label>
              <textarea
                value={selected.notes ?? ''}
                onChange={e => handleNotesChange(e.target.value)}
                rows={2}
                placeholder="Note interne sul display..."
                className="w-full bg-[#0a0a0a] border border-[#232323] rounded-lg px-3 py-2 text-sm text-[#e8e8e8] outline-none focus:border-[#3b82f6] resize-none transition-colors placeholder:text-[#555]"
              />
            </div>

            {/* Playlist */}
            <div className="bg-[#131313] border border-[#232323] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#e8e8e8] uppercase tracking-wider">Scaletta</h3>
                {playlistChanged && (
                  <button onClick={async () => {
                    await publishPlaylistAction(selected.id)
                    await loadDisplayData(selected.id)
                  }}
                    className="bg-[rgba(34,197,94,0.12)] hover:bg-[rgba(34,197,94,0.2)] border border-[rgba(34,197,94,0.3)] text-[#22c55e] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
                    Pubblica scaletta
                  </button>
                )}
              </div>

              {playlist.length === 0 ? (
                <p className="text-sm text-[#555] py-2">Nessun contenuto in scaletta. Aggiungili dalla libreria.</p>
              ) : (
                <div className="space-y-2">
                  {playlist.map((item, idx) => {
                    const m = item.media as unknown as Media
                    return (
                      <div key={item.id} className="flex items-center gap-3 bg-[#0a0a0a] border border-[#232323] rounded-lg p-2.5">
                        {/* Thumbnail */}
                        <div className="w-12 h-9 rounded overflow-hidden bg-[#1a1a1a] flex-shrink-0">
                          {m?.type === 'photo' ? (
                            <img src={mediaUrl(selected.id, m.filename)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[#555]">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#e8e8e8] truncate">{m?.original_name ?? 'Media'}</p>
                          <p className="text-xs text-[#555]">{m?.type === 'video' ? 'Video' : 'Foto'}</p>
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
                              className="w-14 bg-[#131313] border border-[#232323] rounded px-2 py-1 text-xs text-[#e8e8e8] outline-none focus:border-[#3b82f6] text-center" />
                            <span className="text-xs text-[#555]">sec</span>
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
                            className="text-[#555] hover:text-[#888] disabled:opacity-20 text-xs leading-none p-0.5 transition-colors">▲</button>
                          <button onClick={async () => {
                            await reorderPlaylistAction(item.id, 'down', selected.id)
                            await loadDisplayData(selected.id)
                          }} disabled={idx === playlist.length - 1}
                            className="text-[#555] hover:text-[#888] disabled:opacity-20 text-xs leading-none p-0.5 transition-colors">▼</button>
                        </div>

                        {/* Remove */}
                        <button onClick={async () => {
                          await removeFromPlaylistAction(item.id)
                          setPlaylist(prev => prev.filter(p => p.id !== item.id))
                        }}
                          className="text-[#555] hover:text-[#ef4444] transition-colors ml-1">
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
            <div className="bg-[#131313] border border-[#232323] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#e8e8e8] uppercase tracking-wider mb-3">Libreria Media</h3>

              {/* Upload area */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-4 ${
                  dragging ? 'border-[#3b82f6] bg-[rgba(59,130,246,0.05)]' : 'border-[#232323] hover:border-[#333]'
                }`}>
                <p className="text-sm text-[#888]">Trascina qui i file o <span className="text-[#3b82f6]">sfoglia</span></p>
                <p className="text-xs text-[#555] mt-1">Video (.mp4 .mov .webm) max 500MB · Foto (.jpg .png .webp) max 20MB</p>
                <input ref={fileInputRef} type="file" multiple accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                  className="hidden" onChange={e => { if (e.target.files) handleFiles(Array.from(e.target.files)) }} />
              </div>

              {/* Upload progress */}
              {uploads.length > 0 && (
                <div className="space-y-2 mb-4">
                  {uploads.map((u, i) => (
                    <div key={i} className="bg-[#0a0a0a] border border-[#232323] rounded-lg p-2.5">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="text-[#888] truncate">{u.name}</span>
                        <span className={u.error ? 'text-[#ef4444]' : 'text-[#22c55e]'}>
                          {u.error ? 'Errore' : u.done ? 'Completato' : `${u.progress}%`}
                        </span>
                      </div>
                      {!u.error && (
                        <div className="h-1 bg-[#232323] rounded-full overflow-hidden">
                          <div className="h-full bg-[#3b82f6] transition-all" style={{ width: `${u.progress}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Media grid */}
              {media.length === 0 ? (
                <p className="text-sm text-[#555]">Nessun media caricato</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {media.map(m => (
                    <div key={m.id} className="bg-[#0a0a0a] border border-[#232323] rounded-xl overflow-hidden group">
                      <div className="aspect-video bg-[#1a1a1a] relative">
                        {m.type === 'photo' ? (
                          <img src={mediaUrl(selected.id, m.filename)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <video src={mediaUrl(selected.id, m.filename)} className="w-full h-full object-cover" muted />
                        )}
                        <div className="absolute top-1.5 left-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            m.type === 'video' ? 'bg-[rgba(59,130,246,0.8)] text-white' : 'bg-[rgba(34,197,94,0.8)] text-white'
                          }`}>{m.type === 'video' ? 'VID' : 'IMG'}</span>
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-xs text-[#888] truncate" title={m.original_name}>{m.original_name}</p>
                        <p className="text-[10px] text-[#555] mt-0.5">{formatBytes(m.size)}</p>
                        <div className="flex gap-1.5 mt-2">
                          {inPlaylist(m.id) ? (
                            <button onClick={async () => {
                              const item = playlist.find(p => p.media_id === m.id)
                              if (item) {
                                await removeFromPlaylistAction(item.id)
                                setPlaylist(prev => prev.filter(p => p.id !== item.id))
                              }
                            }}
                              className="flex-1 text-[10px] bg-[rgba(59,130,246,0.12)] border border-[rgba(59,130,246,0.2)] text-[#3b82f6] rounded py-1 transition-colors hover:bg-[rgba(59,130,246,0.2)]">
                              Rimuovi
                            </button>
                          ) : (
                            <button onClick={async () => {
                              await addToPlaylistAction(selected.id, m.id)
                              await loadDisplayData(selected.id)
                            }}
                              className="flex-1 text-[10px] bg-[#1a1a1a] border border-[#232323] text-[#888] rounded py-1 transition-colors hover:text-[#e8e8e8] hover:border-[#333]">
                              + Scaletta
                            </button>
                          )}
                          <button onClick={async () => {
                            if (!confirm(`Eliminare "${m.original_name}"?`)) return
                            await deleteMediaAction(m.id, selected.id, m.filename)
                            setMedia(prev => prev.filter(x => x.id !== m.id))
                            setPlaylist(prev => prev.filter(x => x.media_id !== m.id))
                          }}
                            className="text-[10px] bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.15)] text-[#ef4444] rounded py-1 px-2 transition-colors hover:bg-[rgba(239,68,68,0.15)]">
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
            <p className="text-sm text-[#888]">
              Eliminare <strong className="text-[#e8e8e8]">{deleteConfirm.name}</strong>? Tutti i media associati verranno eliminati definitivamente.
            </p>
            <div className="flex gap-2">
              <button onClick={async () => {
                await deleteDisplayAction(deleteConfirm.id)
                setDisplays(prev => prev.filter(d => d.id !== deleteConfirm.id))
                if (selectedId === deleteConfirm.id) setSelectedId(null)
                setDeleteConfirm(null)
              }}
                className="flex-1 bg-[rgba(239,68,68,0.12)] hover:bg-[rgba(239,68,68,0.2)] border border-[rgba(239,68,68,0.2)] text-[#ef4444] rounded-lg py-2 text-sm font-medium transition-colors">
                Elimina
              </button>
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-[#1a1a1a] hover:bg-[#232323] border border-[#232323] text-[#888] rounded-lg py-2 text-sm transition-colors">
                Annulla
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
