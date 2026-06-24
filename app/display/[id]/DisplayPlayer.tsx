'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Display, PublishedItem, Media } from '@/lib/types'

const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL!

function mediaUrl(displayId: string, filename: string) {
  return `${R2_PUBLIC_URL}/${displayId}/${filename}`
}

function urlsOf(items: PublishedItem[], displayId: string) {
  return items
    .map(it => (it.media as unknown as Media | undefined)?.filename)
    .filter((f): f is string => !!f)
    .map(f => `${R2_PUBLIC_URL}/${displayId}/${f}`)
}

function sameUrlSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every(u => s.has(u))
}

export default function DisplayPlayer({ displayId, initialDisplay, initialItems }: {
  displayId: string
  initialDisplay: Display | null
  initialItems: PublishedItem[]
}) {
  const supabase = createClient()
  const [display, setDisplay] = useState<Display | null>(initialDisplay)
  const [items, setItems] = useState<PublishedItem[]>([])
  const [pendingItems, setPendingItems] = useState<PublishedItem[]>(initialItems)
  const [preparing, setPreparing] = useState(true)
  const [prepProgress, setPrepProgress] = useState<string>('')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const swReadyRef = useRef<Promise<ServiceWorker | null>>(
    Promise.resolve(null)
  )

  const currentItem = items[currentIdx]
  const currentMedia = currentItem?.media as unknown as Media | undefined

  // Register service worker once
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) {
      swReadyRef.current = Promise.resolve(null)
      return
    }
    swReadyRef.current = navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(reg => reg.active ?? navigator.serviceWorker.controller ?? null)
      .catch(() => null)
  }, [])

  // Prepare cache whenever pendingItems changes: download missing, delete obsolete, then swap.
  useEffect(() => {
    let cancelled = false
    const urls = urlsOf(pendingItems, displayId)

    // Nothing to cache (empty playlist) → swap immediately
    if (urls.length === 0) {
      setItems(pendingItems)
      setPreparing(false)
      return
    }

    // If pending matches what's already playing, no-op
    if (sameUrlSet(urls, urlsOf(items, displayId)) && items.length > 0) return

    // Only show "preparing" overlay on first load (when nothing is playing yet)
    if (items.length === 0) {
      setPreparing(true)
      setPrepProgress('Preparazione contenuti...')
    }

    swReadyRef.current.then(sw => {
      if (cancelled) return
      if (!sw) {
        // SW unsupported/failed → play direct from network
        setItems(pendingItems)
        setPreparing(false)
        return
      }
      const channel = new MessageChannel()
      channel.port1.onmessage = e => {
        if (cancelled) return
        const r = e.data
        if (r?.type === 'PREPARE_DONE') {
          if (r.failed > 0 && r.downloaded + r.reused === 0) {
            // total failure: keep old playlist playing, will retry on next update
            setPrepProgress('Rete non disponibile. Riprovo...')
          } else {
            setItems(pendingItems)
            setPreparing(false)
            setPrepProgress('')
          }
        }
      }
      sw.postMessage({ type: 'PREPARE_PLAYLIST', urls }, [channel.port2])
    })

    return () => { cancelled = true }
  }, [pendingItems, displayId, items])

  const lastUpdatedRef = useRef<string | null>(initialDisplay?.updated_at ?? null)

  const fetchLatest = useCallback(async () => {
    const [{ data: d }, { data: i }] = await Promise.all([
      supabase.from('displays').select('*').eq('id', displayId).single(),
      supabase.from('published_items').select('*, media(*)').eq('display_id', displayId).order('position'),
    ])
    if (d) {
      setDisplay(d as Display)
      lastUpdatedRef.current = (d as Display).updated_at
    }
    if (i) setPendingItems(i as PublishedItem[])
  }, [supabase, displayId])

  // Lightweight polling: every 60s ask only for displays.updated_at (~500B response).
  // If it changed, do the full fetch. No Realtime WebSocket → zero idle traffic.
  useEffect(() => {
    const checkForUpdates = async () => {
      const { data, error } = await supabase
        .from('displays')
        .select('updated_at')
        .eq('id', displayId)
        .single()
      if (error || !data) return
      if (data.updated_at !== lastUpdatedRef.current) {
        await fetchLatest()
      }
    }

    pollRef.current = setInterval(checkForUpdates, 60000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [supabase, displayId, fetchLatest])

  // Reset idx when items change
  useEffect(() => {
    setCurrentIdx(prev => (items.length > 0 && prev < items.length ? prev : 0))
  }, [items])

  const advance = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
    setTimeout(() => {
      setCurrentIdx(prev => (prev + 1) % Math.max(items.length, 1))
      setVisible(true)
    }, 600)
  }, [items.length])

  useEffect(() => {
    if (!currentItem || currentMedia?.type !== 'photo') return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(advance, currentItem.duration * 1000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [currentIdx, currentItem, currentMedia, advance])

  function handleVideoEnded() {
    if (items.length > 1) advance()
    else if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
    }
  }

  function handleVideoError() {
    if (retryRef.current) clearTimeout(retryRef.current)
    retryRef.current = setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.load()
        videoRef.current.play().catch(() => {})
      }
    }, 5000)
  }

  function handleVideoStall() {
    if (retryRef.current) clearTimeout(retryRef.current)
    retryRef.current = setTimeout(() => {
      if (videoRef.current) videoRef.current.play().catch(() => {})
    }, 2000)
  }

  function handleClick() {
    const el = document.documentElement
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {})
    }
    if (videoRef.current?.paused) {
      videoRef.current.play().catch(() => {})
    }
  }

  const isActive = display?.active && items.length > 0
  const showPreparing = preparing && items.length === 0 && pendingItems.length > 0

  return (
    <div
      onClick={handleClick}
      className="w-screen h-screen bg-black overflow-hidden cursor-none select-none"
      style={{ userSelect: 'none' }}
    >
      {showPreparing ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-2 border-[#333] border-t-[#888] rounded-full animate-spin" />
          <p className="text-[#555] text-sm font-medium">{prepProgress || 'Preparazione contenuti...'}</p>
        </div>
      ) : !isActive ? (
        <div className="w-full h-full flex items-center justify-center">
          <p className="text-[#333] text-sm font-medium">In attesa del contenuto...</p>
        </div>
      ) : (
        <div
          className="w-full h-full transition-opacity duration-[600ms]"
          style={{
            opacity: visible ? 1 : 0,
            backgroundColor: currentMedia?.type === 'photo' ? (currentItem?.bg_color ?? '#000000') : '#000',
          }}
        >
          {currentMedia?.type === 'photo' && (
            <img
              key={currentIdx}
              src={mediaUrl(displayId, currentMedia.filename)}
              alt=""
              className="w-full h-full object-contain"
            />
          )}
          {currentMedia?.type === 'video' && (
            <video
              key={currentIdx}
              ref={videoRef}
              src={mediaUrl(displayId, currentMedia.filename)}
              className="w-full h-full object-contain"
              muted
              autoPlay
              playsInline
              onEnded={handleVideoEnded}
              onError={handleVideoError}
              onStalled={handleVideoStall}
            />
          )}
        </div>
      )}
    </div>
  )
}
