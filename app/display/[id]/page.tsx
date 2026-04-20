import { createClient } from '@supabase/supabase-js'
import DisplayPlayer from './DisplayPlayer'
import type { PublishedItem, Display } from '@/lib/types'

export default async function DisplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [{ data: display }, { data: items }] = await Promise.all([
    supabase.from('displays').select('*').eq('id', id).single(),
    supabase.from('published_items').select('*, media(*)').eq('display_id', id).order('position'),
  ])

  return (
    <DisplayPlayer
      displayId={id}
      initialDisplay={display as Display | null}
      initialItems={(items as PublishedItem[]) ?? []}
    />
  )
}
