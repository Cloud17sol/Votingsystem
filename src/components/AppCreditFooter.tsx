type AppCreditFooterProps = {
  className?: string
}

export function AppCreditFooter({ className = '' }: AppCreditFooterProps) {
  return (
    <p
      className={`text-center text-[0.7rem] leading-relaxed text-zinc-400 ${className}`.trim()}
    >
      Designed & Developed by: <span className="font-medium text-zinc-500">S. Filani</span>
    </p>
  )
}
