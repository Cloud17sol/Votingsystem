import type { ReactNode } from 'react'

type AppTopbarProps = {
  title?: string
  right?: ReactNode
}

const DEFAULT_APP_TITLE = 'Alumni Voting System'

export function AppTopbar({ title = DEFAULT_APP_TITLE, right }: AppTopbarProps) {
  return (
    <header className="app-topbar">
      <h1 className="text-lg font-semibold tracking-tight text-white">{title}</h1>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </header>
  )
}
