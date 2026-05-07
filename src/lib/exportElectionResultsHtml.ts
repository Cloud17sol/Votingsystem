/** Self-contained HTML report for election results (open in browser or print to PDF). */

export type ExportResultsSection = {
  positionName: string
  leaderSummary: string | null
  candidates: Array<{ fullName: string; votes: number }>
}

export type ExportResultsPayload = {
  electionTitle: string
  /** Public URL for optional branding in the report header. */
  logoUrl?: string | null
  turnoutLine: string
  generatedAtLabel: string
  sections: ExportResultsSection[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildElectionResultsHtml(payload: ExportResultsPayload): string {
  const sectionBlocks = payload.sections
    .map((section) => {
      const leaderBlock =
        section.leaderSummary != null
          ? `<p class="leader">${escapeHtml(section.leaderSummary)}</p>`
          : ''

      const rows =
        section.candidates.length === 0
          ? `<tr><td colspan="2" class="muted">No candidates for this position.</td></tr>`
          : section.candidates
              .map(
                (row) =>
                  `<tr>
                    <td>${escapeHtml(row.fullName)}</td>
                    <td class="num">${row.votes}</td>
                  </tr>`,
              )
              .join('')

      return `
        <section class="card">
          <h2>${escapeHtml(section.positionName)}</h2>
          ${leaderBlock}
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th class="num">Votes</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`
    })
    .join('\n')

  const logoBlock =
    payload.logoUrl && payload.logoUrl.trim() !== ''
      ? `<div class="logo-wrap"><img src="${escapeHtml(payload.logoUrl)}" alt="" class="logo-img" /></div>`
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.electionTitle)} — Results</title>
  <style>
    :root {
      --ink: #18181b;
      --muted: #71717a;
      --border: #e4e4e7;
      --accent: #047857;
      --accent-bg: #d1fae5;
      --page: #eceff2;
      --card: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      color: var(--ink);
      background: var(--page);
      line-height: 1.5;
      padding: 2rem 1rem 3rem;
    }
    .wrap {
      max-width: 40rem;
      margin: 0 auto;
    }
    header {
      background: linear-gradient(135deg, #14332a 0%, #1a4334 55%, #1d5c47 100%);
      color: #fff;
      padding: 1.75rem 1.5rem;
      border-radius: 1.25rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 24px rgba(20, 51, 42, 0.18);
    }
    .logo-wrap {
      margin-bottom: 1rem;
    }
    .logo-img {
      max-height: 4.5rem;
      max-width: 14rem;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
    }
    header h1 {
      margin: 0 0 0.35rem;
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    header .subtitle {
      margin: 0;
      font-size: 0.95rem;
      opacity: 0.92;
    }
    .turnout {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
      font-size: 1rem;
      font-weight: 600;
      color: var(--ink);
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1.25rem;
      padding: 1.25rem 1.25rem 1rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 2px 20px rgba(15, 23, 42, 0.06);
    }
    .card h2 {
      margin: 0 0 0.75rem;
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--ink);
      border-bottom: 2px solid var(--accent);
      padding-bottom: 0.35rem;
      display: inline-block;
    }
    .leader {
      margin: 0 0 1rem;
      font-size: 0.9rem;
      font-weight: 600;
      color: #065f46;
      background: var(--accent-bg);
      padding: 0.5rem 0.85rem;
      border-radius: 999px;
      display: inline-block;
      max-width: 100%;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      text-align: left;
      padding: 0.55rem 0.65rem;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: #f4f4f5;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    tbody tr:nth-child(even) td {
      background: #fafafa;
    }
    td.num, th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      width: 5rem;
    }
    td.muted {
      color: var(--muted);
      font-style: italic;
    }
    footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--muted);
      text-align: center;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .wrap { max-width: none; }
      header { break-inside: avoid; }
      .card { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      ${logoBlock}
      <h1>${escapeHtml(payload.electionTitle)}</h1>
      <p class="subtitle">Official results summary</p>
    </header>
    <p class="turnout">${escapeHtml(payload.turnoutLine)}</p>
    ${sectionBlocks}
    <footer>
      ${escapeHtml(payload.generatedAtLabel)}
    </footer>
  </div>
</body>
</html>`
}

export function downloadElectionResultsHtml(
  filenameBase: string,
  payload: ExportResultsPayload,
): void {
  const html = buildElectionResultsHtml(payload)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filenameBase}.html`
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}
