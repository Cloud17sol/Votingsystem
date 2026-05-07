import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type NotificationRow = {
  id: string
  title: string
  body: string
  audience: 'public' | 'member'
  sort_order: number
  created_at: string
}

function formatNotificationDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return ''
  }
}

export function PublicNotificationsPanel() {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('notifications')
        .select('id,title,body,audience,sort_order,created_at')
        .eq('audience', 'public')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })

      if (cancelled) return
      setLoading(false)
      if (error) {
        setItems([])
        return
      }
      setItems((data as NotificationRow[] | null) ?? [])
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading || items.length === 0) return null

  return (
    <aside
      className="w-full max-w-md space-y-3 rounded-2xl border border-sky-200/80 bg-sky-50/90 px-4 py-4 shadow-sm"
      aria-label="Public announcements"
    >
      <h2 className="text-xs font-bold uppercase tracking-wide text-sky-900">Announcements</h2>
      <ul className="space-y-3">
        {items.map((n) => (
          <li
            key={n.id}
            className="rounded-xl border border-sky-100/90 bg-white/90 px-3 py-2.5 shadow-sm"
          >
            <p className="text-sm font-semibold text-zinc-900">{n.title}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{formatNotificationDate(n.created_at)}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{n.body}</p>
          </li>
        ))}
      </ul>
    </aside>
  )
}
