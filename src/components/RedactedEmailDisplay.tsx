type BlurDotsProps = {
  count: number
}

function BlurDots({ count }: BlurDotsProps) {
  if (count <= 0) return null
  const shown = Math.min(count, 36)
  return (
    <span
      className="mx-0.5 inline-block rounded-sm bg-zinc-200/70 px-0.5 align-middle blur-[3.5px] select-none"
      title="Hidden for privacy"
      aria-hidden
    >
      {Array.from({ length: shown }, () => '•').join('')}
      {count > shown ? '…' : null}
    </span>
  )
}

export type MaskedEmailParts = {
  email_local_visible: string
  email_local_blur_len: number
  email_domain_visible: string
  email_domain_blur_len: number
  email_suffix: string
}

type RedactedEmailDisplayProps = MaskedEmailParts & {
  className?: string
}

/** Renders a partially hidden email: ~80% of the local part and ~80% of the domain host are shown as a blurred block; TLD (e.g. `.com`) stays readable. */
export function RedactedEmailDisplay({
  email_local_visible,
  email_local_blur_len,
  email_domain_visible,
  email_domain_blur_len,
  email_suffix,
  className = '',
}: RedactedEmailDisplayProps) {
  return (
    <span
      className={`inline-block text-sm break-all text-zinc-700 ${className}`.trim()}
      aria-label="Email address with most characters hidden for privacy"
    >
      {email_local_visible}
      <BlurDots count={email_local_blur_len} />
      <span aria-hidden>@</span>
      {email_domain_visible}
      <BlurDots count={email_domain_blur_len} />
      {email_suffix}
    </span>
  )
}
