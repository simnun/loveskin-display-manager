'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Display, PublishedItem, Media } from '@/lib/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

function mediaUrl(displayId: string, filename: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/media/${displayId}/${filename}`
}

export default function DisplayPlayer({ displayId, initialDisplay, initialItems }: {
  displayId: string
  initialDisplay: Display | null
  initialItems: PublishedItem[]
}) {
  const supabase = createClient()
  const [display, setDisplay] = useState<Display | null>(initialDisplay)
  const [items, setItems] = useState<PublishedItem[]>(initialItems)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentItem = items[currentIdx]
  const currentMedia = currentItem?.media as unknown as Media | undefined

  const fetchLatest = useCallback(async () => {
    const [{ data: d }, { data: i }] = await Promise.all([
      supabase.from('displays').select('*').eq('id', displayId).single(),
      supabase.from('published_items').select('*, media(*)').eq('display_id', displayId).order('position'),
    ])
    if (d) setDisplay(d as Display)
    if (i) setItems(i as PublishedItem[])
  }, [supabase, displayId])

  // Realtime subscription + polling fallback
  useEffect(() => {
    let realtimeOk = false

    const ch = supabase.channel(`display-${displayId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'published_items', filter: `display_id=eq.${displayId}` }, fetchLatest)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'displays', filter: `id=eq.${displayId}` }, fetchLatest)
      .subscribe(status => {
        realtimeOk = status === 'SUBSCRIBED'
      })

    // Polling fallback every 30s
    pollRef.current = setInterval(() => {
      if (!realtimeOk) fetchLatest()
    }, 30000)

    return () => {
      supabase.removeChannel(ch)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [supabase, displayId, fetchLatest])

  // Reset to idx 0 when items change (but keep current if still valid)
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

  // Photo timer
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

  return (
    <div
      onClick={handleClick}
      className="w-screen h-screen bg-black overflow-hidden cursor-none select-none"
      style={{ userSelect: 'none' }}
    >
      {!isActive ? (
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
