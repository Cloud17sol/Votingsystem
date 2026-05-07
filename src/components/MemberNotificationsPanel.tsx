import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { NotificationRow } from './PublicNotificationsPanel'

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

type Props = {
  /** Narrow container (ballot) vs full admin width */
  variant?: 'narrow' | 'wide'
}

export function MemberNotificationsPanel({ variant = 'narrow' }: Props) {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        if (!cancelled) {
          setLoading(false)
          setItems([])
        }
        return
      }

      const { data, error } = await supabase
        .from('notifications')
        .select('id,title,body,audience,sort_order,created_at')
        .eq('audience', 'member')
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

  const widthClass = variant === 'wide' ? 'w-full max-w-5xl' : 'w-full max-w-2xl'

  return (
    <aside
      className={`${widthClass} space-y-3 rounded-2xl border border-mint-700/20 bg-mint-50/80 px-4 py-4 shadow-sm`}
      aria-label="Member announcements"
    >
      <h2 className="text-xs font-bold uppercase tracking-wide text-mint-900">For members</h2>
      <ul className="space-y-3">
        {items.map((n) => (
          <li
            key={n.id}
            className="rounded-xl border border-mint-200/80 bg-white/95 px-3 py-2.5 shadow-sm"
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
