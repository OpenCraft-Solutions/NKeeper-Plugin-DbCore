import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ToolError, type ToolClient } from './client'
import { errorHeading, formatElapsed, lineRange, outputText, scriptToRun, storedNumber, storeNumber } from './format'
import { ResultGrid } from './ResultGrid'
import type { DatabaseEngineInfo, OpenedWindow, SqlQueryResult } from './types'
import { Spinner, Splitter } from './ui'

interface QueryWindowProps {
  client: ToolClient
  engine: DatabaseEngineInfo
  title: string
  /** e.g. "sa@SQL01", for the status line. */
  target: string
  databases: string[]
  initialSql: string
  initialDatabase?: string
  /** Runs the script as soon as the window is connected (Select Top 1000 Rows). */
  runOnOpen?: boolean
  active: boolean
}

const EDITOR_SHARE_KEY = 'nkeeper.db.editorShare'
/** The editor's share of the height it splits with the results, as in SSMS's default. */
const DEFAULT_EDITOR_SHARE = 0.45
const MIN_SHARE = 0.1
const MAX_SHARE = 0.9

const clampShare = (share: number) => Math.min(Math.max(share, MIN_SHARE), MAX_SHARE)

type Connection =
  | { state: 'opening' }
  | { state: 'ready'; window: string; sessionId: number; login: string }
  /** Its connection closed (a severe error, or the server ended it): running again opens another. */
  | { state: 'disconnected' }
  | { state: 'failed'; message: string }

const message = (error: unknown, fallback: string) => (error instanceof ToolError ? error.message : fallback)

/**
 * A query window, as in SSMS (ported from 1.x): its own connection (its own session on the server, current database,
 * temporary tables and transactions), an editor, and the results as grids or text with the messages beside them.
 * F5, Ctrl+Enter or Ctrl+E run the selection, or everything when nothing is selected.
 */
export function QueryWindow({ client, engine, title, target, databases, initialSql, initialDatabase, runOnOpen, active }: QueryWindowProps) {
  const [connection, setConnection] = useState<Connection>({ state: 'opening' })
  const [attempt, setAttempt] = useState(0)
  const [sql, setSql] = useState(initialSql)
  const [database, setDatabase] = useState(initialDatabase ?? '')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SqlQueryResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [finishedAt, setFinishedAt] = useState<Date | null>(null)
  const [view, setView] = useState<'grid' | 'text'>('grid')
  const [tab, setTab] = useState<'results' | 'messages'>('results')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const ranOnOpen = useRef(false)
  const windowRef = useRef<string | null>(null)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const resultsPaneRef = useRef<HTMLDivElement>(null)
  // Shared by every window in this browser: the last split chosen.
  const [editorShare, setEditorShare] = useState(() => clampShare(storedNumber(EDITOR_SHARE_KEY, DEFAULT_EDITOR_SHARE)))

  function resizeEditor(share: number) {
    const next = clampShare(share)
    setEditorShare(next)
    storeNumber(EDITOR_SHARE_KEY, next)
  }

  function shareAt(clientY: number): number {
    const top = editorPaneRef.current?.getBoundingClientRect().top ?? 0
    const bottom = resultsPaneRef.current?.getBoundingClientRect().bottom ?? top + 1
    return (clientY - top) / Math.max(bottom - top, 1)
  }

  /** Opens a connection for the window, in a database; closes the one it had. */
  async function open(inDatabase: string | undefined): Promise<string | null> {
    try {
      const opened = await client.request<OpenedWindow>('window.open', inDatabase ? { database: inDatabase } : {})
      if (windowRef.current && windowRef.current !== opened.window) {
        void client.request('window.close', { window: windowRef.current }).catch(() => {})
      }
      windowRef.current = opened.window
      setConnection({ state: 'ready', window: opened.window, sessionId: opened.sessionId, login: opened.login })
      setDatabase(opened.database)
      if (opened.warning) {
        setRunError(`Opened in ${opened.database}: ${opened.warning}`)
      }
      return opened.window
    } catch (error) {
      setConnection({ state: 'failed', message: message(error, 'Couldn’t open a connection for this window.') })
      return null
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const opened = await open(initialDatabase)
      if (cancelled && opened) {
        void client.request('window.close', { window: opened }).catch(() => {})
      }
    })()
    return () => {
      cancelled = true
      if (windowRef.current) {
        void client.request('window.close', { window: windowRef.current }).catch(() => {})
        windowRef.current = null
      }
    }
    // The starting database is fixed for the window's life; `attempt` reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, attempt])

  const ready = connection.state === 'ready' ? connection : null

  useEffect(() => {
    if (ready && runOnOpen && !ranOnOpen.current) {
      ranOnOpen.current = true
      void execute()
    }
    // Only once, when the window first connects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready?.window])

  useEffect(() => {
    if (active) {
      editorRef.current?.focus()
    }
  }, [active, ready?.window])

  async function execute() {
    if (running || (connection.state !== 'ready' && connection.state !== 'disconnected')) {
      return
    }
    const editor = editorRef.current
    const { sql: script, lineOffset } = scriptToRun(sql, editor?.selectionStart ?? 0, editor?.selectionEnd ?? 0)
    if (!script.trim()) {
      return
    }
    setRunning(true)
    setRunError(null)
    try {
      const id = connection.state === 'ready' ? connection.window : await open(database || initialDatabase)
      if (!id) {
        return
      }
      const next = await client.request<SqlQueryResult>('query', { window: id, sql: script, lineOffset })
      setResult(next)
      setFinishedAt(new Date())
      setTab(next.output.some((o) => o.kind === 'results') ? 'results' : 'messages')
      if (next.database) {
        setDatabase(next.database)
      }
      if (next.connectionLost) {
        windowRef.current = null
        setConnection({ state: 'disconnected' })
      }
    } catch (error) {
      setRunError(message(error, 'Couldn’t run the query.'))
    } finally {
      setRunning(false)
    }
  }

  function cancel() {
    if (ready) {
      void client.request('cancel', { window: ready.window }).catch(() => {})
    }
  }

  async function changeDatabase(name: string) {
    if (!ready) {
      return
    }
    setRunError(null)
    try {
      setDatabase((await client.request<{ name: string }>('use', { window: ready.window, name })).name)
    } catch (error) {
      setRunError(message(error, 'Couldn’t change the database.'))
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const ctrl = event.ctrlKey || event.metaKey
    if (event.key === 'F5' || (ctrl && event.key === 'Enter') || (ctrl && !event.shiftKey && event.key.toLowerCase() === 'e')) {
      event.preventDefault()
      void execute()
    } else if (event.key === 'Tab' && !ctrl && !event.altKey && !event.shiftKey) {
      // Indent, as editors do; Shift+Tab still leaves the editor.
      event.preventDefault()
      const editor = event.currentTarget
      const { selectionStart: start, selectionEnd: end } = editor
      setSql(`${sql.slice(0, start)}    ${sql.slice(end)}`)
      requestAnimationFrame(() => editor.setSelectionRange(start + 4, start + 4))
    }
  }

  /** Selects an error's line in the editor (as double-clicking it does in SSMS). */
  function goToLine(line: number) {
    const editor = editorRef.current
    if (editor) {
      const [start, end] = lineRange(sql, line)
      editor.focus()
      editor.setSelectionRange(start, end)
    }
  }

  const lines = sql.split('\n').length
  const output = result?.output ?? []
  const resultSets = output.filter((o) => o.kind === 'results')
  const messages = output.filter((o) => o.kind !== 'results')
  const rowsSent = resultSets.reduce((sum, r) => sum + (r.rowCount ?? 0), 0)
  const databaseOptions = database && !databases.includes(database) ? [database, ...databases] : databases
  const canRun = connection.state === 'ready' || connection.state === 'disconnected'
  const showMessages = tab === 'messages' || resultSets.length === 0

  const busy = (
    <p className="nk-db-muted">
      <Spinner /> Executing query…
    </p>
  )
  const failure = runError ? (
    <p className="nk-db-error-text" role="alert">
      {runError}
    </p>
  ) : null

  return (
    <div className="nk-db-window" hidden={!active} role="tabpanel" aria-label={title}>
      <div className="nk-db-toolbar">
        {running ? (
          <button type="button" className="nk-db-button" data-danger="" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="nk-db-button" data-primary="" onClick={() => void execute()} disabled={!canRun} title="F5 or Ctrl+Enter">
            ▶ Execute
          </button>
        )}
        {engine.databaseLabel ? (
          <label className="nk-db-field">
            <span>{engine.databaseLabel}</span>
            <select value={database} onChange={(event) => void changeDatabase(event.target.value)} disabled={!ready || running} aria-label={engine.databaseLabel}>
              {databaseOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="nk-db-segmented" role="group" aria-label="Results to">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            Grid
          </button>
          <button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')}>
            Text
          </button>
        </div>
        {ready ? (
          <span className="nk-db-note">
            {ready.login} ({ready.sessionId})
          </span>
        ) : connection.state === 'disconnected' ? (
          <span className="nk-db-note">Disconnected · reconnects when you run</span>
        ) : null}
      </div>

      {connection.state === 'failed' ? (
        <div className="nk-db-notice" data-error="" role="alert">
          <span>{connection.message}</span>
          <button
            type="button"
            className="nk-db-button"
            onClick={() => {
              setConnection({ state: 'opening' })
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="nk-db-editor" ref={editorPaneRef} style={{ flexGrow: editorShare }}>
        <div className="nk-db-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={editorRef}
          className="nk-db-code"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            if (gutterRef.current) {
              gutterRef.current.scrollTop = event.currentTarget.scrollTop
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          aria-label={`${title} query`}
          placeholder={`${engine.placeholder ?? 'SELECT …'}  — F5 or Ctrl+Enter runs it (or just the selection)`}
        />
      </div>

      <Splitter
        direction="rows"
        label="Resize editor and results"
        value={editorShare * 100}
        min={MIN_SHARE * 100}
        max={MAX_SHARE * 100}
        onMove={(y) => resizeEditor(shareAt(y))}
        onStep={(direction, big) => resizeEditor(editorShare + direction * (big ? 0.15 : 0.05))}
        onReset={() => resizeEditor(DEFAULT_EDITOR_SHARE)}
      />

      <div className="nk-db-results" aria-label="Results" ref={resultsPaneRef} style={{ flexGrow: 1 - editorShare }}>
        {result || runError || running ? (
          view === 'grid' ? (
            <>
              <div className="nk-db-result-tabs" role="tablist" aria-label="Results and messages">
                {resultSets.length > 0 ? (
                  <button type="button" role="tab" aria-selected={tab === 'results'} onClick={() => setTab('results')}>
                    Results
                  </button>
                ) : null}
                <button type="button" role="tab" aria-selected={showMessages} onClick={() => setTab('messages')}>
                  Messages
                </button>
              </div>
              <div className="nk-db-result-body">
                {running ? busy : null}
                {failure}
                {!running && !showMessages ? resultSets.map((set, i) => <ResultGrid key={i} output={set} label={`Result ${i + 1}`} />) : null}
                {!running && showMessages && result ? (
                  <div className="nk-db-messages" role="log" aria-label="Messages">
                    {messages.map((item, i) =>
                      item.kind === 'error' ? (
                        <button
                          key={i}
                          type="button"
                          className="nk-db-error-message"
                          onDoubleClick={() => item.line && goToLine(item.line)}
                          onClick={(event) => event.detail === 0 && item.line && goToLine(item.line)}
                          title={item.line ? 'Double-click to go to the line' : undefined}
                        >
                          {errorHeading(item) ? <span>{errorHeading(item)}</span> : null}
                          <span>{item.text}</span>
                        </button>
                      ) : (
                        <p key={i}>{item.text}</p>
                      ),
                    )}
                    {finishedAt ? <p className="nk-db-muted">Completion time: {finishedAt.toISOString()}</p> : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="nk-db-result-body">
              {running ? busy : null}
              {failure}
              {!running && result ? (
                <pre className="nk-db-text-results" aria-label="Results as text">
                  {outputText(output)}
                  {finishedAt ? `\n\nCompletion time: ${finishedAt.toISOString()}` : ''}
                </pre>
              ) : null}
            </div>
          )
        ) : (
          <p className="nk-db-results-empty">Results appear here.</p>
        )}
      </div>

      <div className="nk-db-query-status" data-warn={result?.cancelled || result?.hasErrors ? '' : undefined} role="status" aria-label={`${title} status`}>
        <span>
          {connection.state === 'opening'
            ? 'Connecting…'
            : running
              ? 'Executing query…'
              : !result
                ? ready
                  ? 'Connected.'
                  : 'Disconnected.'
                : result.cancelled
                  ? 'Query was cancelled.'
                  : result.hasErrors
                    ? 'Query completed with errors.'
                    : 'Query executed successfully.'}
        </span>
        <span>{target}</span>
        {database ? <span>{database}</span> : null}
        {result ? <span>{formatElapsed(result.elapsedMs)}</span> : null}
        {result ? <span>{rowsSent.toLocaleString()} rows</span> : null}
      </div>
    </div>
  )
}
