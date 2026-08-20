/** Soft forest wash + grid matching `.app-topbar` greens. */
export function GridBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0"
      style={{
        background: `
          radial-gradient(ellipse 90% 55% at 50% -10%, rgba(29, 92, 71, 0.22), transparent 60%),
          radial-gradient(circle at 50% 45%, rgba(26, 67, 52, 0.08), transparent 65%),
          #eceff2
        `,
      }}
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(20, 51, 42, 0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(20, 51, 42, 0.06) 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px',
        }}
      />
    </div>
  )
}
