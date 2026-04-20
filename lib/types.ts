export interface Display {
  id: string
  name: string
  width: number
  height: number
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface Media {
  id: string
  display_id: string
  filename: string
  original_name: string
  type: 'video' | 'photo'
  size: number
  content_type: string
  uploaded_at: string
}

export interface PlaylistItem {
  id: string
  display_id: string
  media_id: string
  position: number
  duration: number
  bg_color: string
  media?: Media
}

export interface PublishedItem {
  id: string
  display_id: string
  media_id: string
  position: number
  duration: number
  bg_color: string
  media?: Media
}
