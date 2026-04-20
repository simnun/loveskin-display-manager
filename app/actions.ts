'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// --- Auth ---
export async function loginAction(email: string, password: string) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  return { error: null }
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/admin')
}

// --- Displays ---
export async function createDisplayAction(name: string, width: number, height: number) {
  const admin = createAdminClient()
  const id = genId('disp')
  const { error } = await admin.from('displays').insert({ id, name, width, height })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null, id }
}

export async function updateDisplayAction(id: string, data: { name?: string; width?: number; height?: number }) {
  const admin = createAdminClient()
  const { error } = await admin.from('displays').update(data).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}

export async function updateNotesAction(id: string, notes: string) {
  const admin = createAdminClient()
  const { error } = await admin.from('displays').update({ notes }).eq('id', id)
  if (error) return { error: error.message }
  return { error: null }
}

export async function toggleActiveAction(id: string, active: boolean) {
  const admin = createAdminClient()
  const { error } = await admin.from('displays').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}

export async function deleteDisplayAction(id: string) {
  const admin = createAdminClient()

  // Get all media for this display to delete from storage
  const { data: mediaList } = await admin.from('media').select('id, filename').eq('display_id', id)
  if (mediaList?.length) {
    const paths = mediaList.map(m => `${id}/${m.filename}`)
    await admin.storage.from('media').remove(paths)
  }

  const { error } = await admin.from('displays').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}

// --- Media ---
export async function registerMediaAction(data: {
  displayId: string
  filename: string
  originalName: string
  type: 'video' | 'photo'
  size: number
  contentType: string
}) {
  const admin = createAdminClient()
  const id = genId('media')
  const { error } = await admin.from('media').insert({
    id,
    display_id: data.displayId,
    filename: data.filename,
    original_name: data.originalName,
    type: data.type,
    size: data.size,
    content_type: data.contentType,
  })
  if (error) return { error: error.message, id: null }
  revalidatePath('/admin')
  return { error: null, id }
}

export async function deleteMediaAction(mediaId: string, displayId: string, filename: string) {
  const admin = createAdminClient()

  await admin.storage.from('media').remove([`${displayId}/${filename}`])
  await admin.from('playlist_items').delete().eq('media_id', mediaId)
  await admin.from('published_items').delete().eq('media_id', mediaId)

  const { error } = await admin.from('media').delete().eq('id', mediaId)
  if (error) return { error: error.message }

  // If published_items now empty, deactivate display
  const { count } = await admin
    .from('published_items')
    .select('id', { count: 'exact', head: true })
    .eq('display_id', displayId)
  if (count === 0) {
    await admin.from('displays').update({ active: false }).eq('id', displayId)
  }

  revalidatePath('/admin')
  return { error: null }
}

// --- Playlist ---
export async function addToPlaylistAction(displayId: string, mediaId: string) {
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('playlist_items')
    .select('position')
    .eq('display_id', displayId)
    .order('position', { ascending: false })
    .limit(1)
  const position = existing?.[0]?.position ?? -1
  const { error } = await admin.from('playlist_items').insert({
    display_id: displayId,
    media_id: mediaId,
    position: position + 1,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}

export async function removeFromPlaylistAction(itemId: string) {
  const admin = createAdminClient()
  const { error } = await admin.from('playlist_items').delete().eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}

export async function updatePlaylistItemAction(itemId: string, data: { duration?: number; bg_color?: string }) {
  const admin = createAdminClient()
  const { error } = await admin.from('playlist_items').update(data).eq('id', itemId)
  if (error) return { error: error.message }
  return { error: null }
}

export async function reorderPlaylistAction(itemId: string, direction: 'up' | 'down', displayId: string) {
  const admin = createAdminClient()
  const { data: items } = await admin
    .from('playlist_items')
    .select('id, position')
    .eq('display_id', displayId)
    .order('position')
  if (!items) return { error: 'No items' }

  const idx = items.findIndex(i => i.id === itemId)
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= items.length) return { error: null }

  const a = items[idx], b = items[swapIdx]
  await admin.from('playlist_items').update({ position: b.position }).eq('id', a.id)
  await admin.from('playlist_items').update({ position: a.position }).eq('id', b.id)
  revalidatePath('/admin')
  return { error: null }
}

export async function publishPlaylistAction(displayId: string) {
  const admin = createAdminClient()

  const { data: playlist } = await admin
    .from('playlist_items')
    .select('*')
    .eq('display_id', displayId)
    .order('position')

  await admin.from('published_items').delete().eq('display_id', displayId)

  if (playlist?.length) {
    const toInsert = playlist.map(({ id: _id, ...rest }) => ({ ...rest }))
    await admin.from('published_items').insert(toInsert)
    await admin.from('displays').update({ active: true }).eq('id', displayId)
  }

  revalidatePath('/admin')
  return { error: null }
}
