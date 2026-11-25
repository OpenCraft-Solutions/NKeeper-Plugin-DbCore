import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ToolError, type ToolClient } from './client'
import { ResultGrid } from './ResultGrid'
import type { DatabaseReportInfo, SqlOutput, ToolReport, ToolScript } from './types'

/** Grids as they are; runs of messages joined into one block, as a procedure that prints its output reads best. */
function grouped(results: SqlOutput[]): SqlOutput[] {
  const out: SqlOutput[] = []
  for (const result of results) {
    const last = out.at(-1)
    if (result.kind !== 'results' && last && last.kind !== 'results') {
      out[out.length - 1] = { ...last, text: `${last.text ?? ''}\n${result.text ?? ''}` }
    } else {
      out.push(result)
    }
  }
  return out
}

/**
 * One of the engine's Management reports (db-core 1.1, ported from 1.x's ToolReportView and ReportSections): what needs
 * looking at, then each section's grids, with the scripts it offers. SQL opens in a query window; other scripts
 * (RMAN) are shown to copy. A report only reads: nothing it offers runs by itself.
 */
export function ReportView({ client, report, active, onOpenQuery }: { client: ToolClient; report: DatabaseReportInfo; active: boolean; onOpenQuery: (sql: string) => void }) {
  const prefix = useId()
  const [data, setData] = useState<ToolReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<ToolScript | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await client.request<ToolReport>('report', { name: report.name }))
    } catch (e) {
      setError(e instanceof ToolError ? e.message : `Couldn’t read ${report.label}.`)
    } finally {
      setLoading(false)
    }
  }, [client, report])

  // Read the first time the tab is shown; Refresh reads it again.
  const read = useRef(false)
  useEffect(() => {
    if (active && !read.current) {
      read.current = true
      queueMicrotask(() => void refresh())
    }
  }, [active, refresh])

  const anchor = (index: number) => `${prefix}-section-${index}`
  const sections = data?.sections ?? []

  return (
    <div className="nk-db-tool" hidden={!active} role="tabpanel" aria-label={report.label}>
      <header className="nk-db-tool-header">
        <div>
          <h2>{report.label}</h2>
          <p>{report.detail}</p>
        </div>
        <div className="nk-db-actions">
          <span className="nk-db-note">{data ? new Date(data.atUtc).toLocaleTimeString() : null}</span>
          <button type="button" className="nk-db-button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? (
        <p className="nk-db-notice" data-error="" role="alert">
          {error}
        </p>
      ) : null}
      {data && data.warnings.length === 0 ? (
        <p className="nk-db-notice" role="status">
          Nothing needs attention.
        </p>
      ) : null}
      {data && data.warnings.length > 0 ? (
        <ul className="nk-db-notice" data-error="" aria-label="Needs attention">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {sections.length >= 3 ? (
        <nav className="nk-db-report-nav" aria-label="Sections">
          <span className="nk-db-muted">On this page:</span>
          {sections.map((section, index) => (
            <button
              key={anchor(index)}
              type="button"
              className="nk-db-button"
              data-ghost=""
              onClick={() => {
                const element = document.getElementById(anchor(index))
                if (element instanceof HTMLDetailsElement) {
                  element.open = true
                }
                element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {section.title}
              {section.error ? ' (failed)' : ''}
            </button>
          ))}
        </nav>
      ) : null}

      {sections.map((section, sectionIndex) => (
        <details key={anchor(sectionIndex)} id={anchor(sectionIndex)} className="nk-db-report-section" open>
          <summary>
            <h3>{section.title}</h3> <code className="nk-db-muted">{section.command}</code>
          </summary>
          {section.note ? <p className="nk-db-muted">{section.note}</p> : null}
          {section.error ? (
            <p className="nk-db-notice" data-error="">
              {section.error}
            </p>
          ) : null}
          {grouped(section.results).map((result, index) =>
            result.kind === 'results' ? (
              <div key={index} className="nk-db-report-grid">
                {result.rows && result.rows.length > 0 ? <ResultGrid output={result} label={`${section.title} results`} /> : <p className="nk-db-muted">No rows.</p>}
              </div>
            ) : (
              <pre key={index} className="nk-db-report-message">
                {result.text}
              </pre>
            ),
          )}
          {!section.error && section.results.length === 0 ? <p className="nk-db-muted">Nothing returned.</p> : null}
          {section.scripts && section.scripts.length > 0 ? (
            <div className="nk-db-actions" aria-label={`Scripts for ${section.title}`}>
              {section.scripts.map((script) => (
                <button
                  key={script.label}
                  type="button"
                  className="nk-db-button"
                  title={script.text}
                  onClick={() => (script.kind === 'sql' ? onOpenQuery(script.text) : setShown(script))}
                >
                  {script.label}
                  {script.kind === 'sql' ? '' : '…'}
                </button>
              ))}
            </div>
          ) : null}
        </details>
      ))}

      {shown ? (
        <section className="nk-db-report-copy" aria-label={shown.label}>
          <h3>{shown.label}</h3>
          <p className="nk-db-muted">Run this on the database server: RMAN commands in rman target /, scripts starting with @ in SQL*Plus as SYSDBA.</p>
          <pre className="nk-db-report-message">{shown.text}</pre>
          <div className="nk-db-actions">
            <button type="button" className="nk-db-button" onClick={() => void navigator.clipboard?.writeText(shown.text).catch(() => {})}>
              Copy
            </button>
            <button type="button" className="nk-db-button" onClick={() => setShown(null)}>
              Close
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
