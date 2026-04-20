import { createClient } from '@/lib/supabase/server'
import AdminDashboard from './AdminDashboard'
import type { Display } from '@/lib/types'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: displays } = await supabase
    .from('displays')
    .select('*')
    .order('created_at', { ascending: true })

  return <AdminDashboard initialDisplays={(displays as Display[]) ?? []} />
}
