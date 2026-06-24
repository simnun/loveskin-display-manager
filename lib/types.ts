export interface Display {
  id: string
  name: string
  width: number
  height: number
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
  // LED wall control (TB50 via Raspberry agent)
  power_state: 'on' | 'off'
  brightness: number
  schedule_on: string | null
  schedule_off: string | null
  schedule_enabled: boolean
  agent_last_seen: string | null
  agent_ip: string | null
  has_signal: boolean | null
}

export type DisplayCommandName =
  | 'power_on'
  | 'power_off'
  | 'set_brightness'
  | 'freeze'
  | 'normal'

export interface DisplayCommand {
  id: string
  display_id: string
  command: DisplayCommandName
  payload: Record<string, unknown> | null
  status: 'pending' | 'done' | 'error'
  error: string | null
  created_at: string
  executed_at: string | null
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
