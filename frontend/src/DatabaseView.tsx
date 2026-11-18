import { useEffect, useRef, useState } from 'react'
import type { SessionViewProps } from '@nkeeper/sdk'
import { BlockingManager } from './BlockingManager'
import { ToolError, type ToolClient } from './client'
import { storedNumber, storeNumber } from './format'
import { ObjectExplorer } from './ObjectExplorer'
import { QueryWindow } from './QueryWindow'
import { useTool } from './tool'
import { TOOLS, type DatabaseEngineInfo, type ScriptAction, type ServerInfo, type SqlObjectNode } from './types'
import { Spinner, Splitter } from './ui'

/** What an engine's view gives db-core's: the session view's own props, and the engine. */
export interface DatabaseViewProps extends SessionViewProps {
  engine: DatabaseEngineInfo
}

/** A document tab: a query window (its own connection, as in SSMS), or a Management tool. */
type Document =
  | { id: string; kind: 'query'; title: string; sql: string; database?: string; runOnOpen?: boolean }
  | { id: string; kind: 'tool'; tool: string; title: string }

type NewDocument = { kind: 'query'; sql: string; database?: string; runOnOpen?: boolean; title?: string } | { kind: 'tool'; tool: string }

let nextDocument = 1

const EXPLORER_WIDTH_KEY = 'nkeeper.db.explorerWidth'
const DEFAULT_EXPLORER_WIDTH = 280
const MIN_EXPLORER_WIDTH = 160
/** The query windows keep at least this much room beside the explorer. */
const MIN_DOCUMENTS_WIDTH = 320

const END_TITLE = 'The database session'

/**
 * A database tab, like a small SSMS (docs/architecture.md §7.32, ported from 1.x): the object explorer on the left
 * (resizable), query windows and Management tools as tabs on the right. It's one session of the engine's session
 * type: core signs in, and each query window opens a connection of its own with the same login.
 */
export function DatabaseView({ connect, host, visible, engine }: DatabaseViewProps) {
  const { state, reconnect } = useTool(connect, END_TITLE)
  const dot = state.kind === 'open' ? 'open' : state.kind
  return (
    <div className="nk-db" hidden={!visible} role="region" aria-label={`${host.name} ${engine.product}`}>
      <div className="nk-db-status">
        <span className="nk-db-dot" data-state={dot} />
        <span className="nk-db-status-text">
          {state.kind === 'connecting' ? 'Connecting…' : state.kind === 'open' ? engine.product : state.failed ? "Couldn't connect" : 'Ended'}
        </span>
        <span className="nk-db-muted">{host.name}</span>
        <div className="nk-db-actions">
          {state.kind === 'ended' && !state.failed ? <span className="nk-db-muted">{state.message}</span> : null}
          {state.kind === 'ended' && !state.failed ? (
            <button type="button" className="nk-db-button" onClick={reconnect}>
              Reconnect
            </button>
          ) : null}
        </div>
      </div>
      <div className="nk-db-area">
        {state.kind === 'connecting' ? <Connecting engine={engine} host={host} /> : null}
        {state.kind === 'ended' && state.failed ? <Failed engine={engine} message={state.message} reconnect={reconnect} /> : null}
        {state.kind === 'open' ? <Connected client={state.client} engine={engine} host={host} visible={visible} reconnect={reconnect} /> : null}
      </div>
    </div>
  )
}

/** One connection's tab: what the server says it is, then the workspace. A reconnection mounts another. */
function Connected({ client, engine, host, visible, reconnect }: { client: ToolClient; engine: DatabaseEngineInfo; host: { name: string }; visible: boolean; reconnect: () => void }) {
  const [info, setInfo] = useState<{ server: ServerInfo } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    client.request<{ server: ServerInfo }>('info').then(
      ({ server }) => !cancelled && setInfo({ server }),
      (error: unknown) => !cancelled && setInfo({ error: error instanceof ToolError ? error.message : 'The server didn’t say what it is.' }),
    )
    return () => {
      cancelled = true
    }
  }, [client])

  if (info === null) {
    return <Connecting engine={engine} host={host} />
  }
  if ('error' in info) {
    return <Failed engine={engine} message={info.error} reconnect={reconnect} />
  }
  return <Workspace client={client} engine={engine} server={info.server} visible={visible} />
}

function Connecting({ engine, host }: { engine: DatabaseEngineInfo; host: { name: string } }) {
  return (
    <div className="nk-db-overlay">
      <div className="nk-db-card nk-db-card-row" role="status">
        <Spinner />
        <span>
          Connecting to {engine.product} on {host.name}…
        </span>
      </div>
    </div>
  )
}

function Failed({ engine, message, reconnect }: { engine: DatabaseEngineInfo; message: string; reconnect: () => void }) {
  return (
    <div className="nk-db-overlay">
      <div className="nk-db-card" data-error="" role="alert">
        <h3>Couldn’t connect to {engine.product}</h3>
        <p>{message}</p>
        <div className="nk-db-card-actions">
          <button type="button" className="nk-db-button" data-primary="" onClick={reconnect}>
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}

function Workspace({ client, engine, server, visible }: { client: ToolClient; engine: DatabaseEngineInfo; server: ServerInfo; visible: boolean }) {
  const [documents, setDocuments] = useState<Document[]>(() => [{ id: `doc-${nextDocument++}`, kind: 'query', title: 'SQLQuery1', sql: '' }])
  const [activeDocument, setActiveDocument] = useState<string | null>(() => documents[0]?.id ?? null)
  const [databases, setDatabases] = useState<string[]>([])
  const [explorerError, setExplorerError] = useState<string | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [explorerWidth, setExplorerWidth] = useState(() => storedNumber(EXPLORER_WIDTH_KEY, DEFAULT_EXPLORER_WIDTH))
  const [maxWidth, setMaxWidth] = useState(1200 - MIN_DOCUMENTS_WIDTH)
  const target = `${server.login}@${server.serverName}`

  useEffect(() => {
    let cancelled = false
    client.request<string[]>('databases').then(
      (names) => !cancelled && setDatabases(names),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [client])

  // The explorer leaves the documents at least their room, however wide the workspace is now.
  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setMaxWidth(Math.max(MIN_EXPLORER_WIDTH, (entry?.contentRect.width || 1200) - MIN_DOCUMENTS_WIDTH))
    })
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])

  function maxExplorerWidth(): number {
    const total = workspaceRef.current?.getBoundingClientRect().width || 1200
    return Math.max(MIN_EXPLORER_WIDTH, total - MIN_DOCUMENTS_WIDTH)
  }

  function resizeExplorer(width: number) {
    const next = Math.min(Math.max(width, MIN_EXPLORER_WIDTH), maxExplorerWidth())
    setExplorerWidth(next)
    storeNumber(EXPLORER_WIDTH_KEY, next)
  }

  function addDocument(document: NewDocument) {
    if (document.kind === 'tool') {
      // One of each tool: opening it again shows the one that's open.
      const existing = documents.find((d) => d.kind === 'tool' && d.tool === document.tool)
      if (existing) {
        setActiveDocument(existing.id)
        return
      }
    }
    const id = `doc-${nextDocument++}`
    const queries = documents.filter((d) => d.kind === 'query').length
    const added: Document =
      document.kind === 'query'
        ? { ...document, id, title: document.title ?? `SQLQuery${queries + 1}` }
        : { kind: 'tool', tool: document.tool, id, title: TOOLS[document.tool]?.title ?? document.tool }
    setDocuments((current) => [...current, added])
    setActiveDocument(id)
  }

  function closeDocument(id: string) {
    setDocuments((current) => {
      const index = current.findIndex((d) => d.id === id)
      const next = current.filter((d) => d.id !== id)
      if (activeDocument === id) {
        setActiveDocument(next[Math.min(index, next.length - 1)]?.id ?? null)
      }
      return next
    })
  }

  async function script(node: SqlObjectNode, action: ScriptAction) {
    setExplorerError(null)
    try {
      const { sql } = await client.request<{ sql: string }>('script', { node, action })
      addDocument({
        kind: 'query',
        sql,
        database: node.database ?? undefined,
        // "Select Top 1000 Rows" runs straight away, as in SSMS.
        runOnOpen: action === 'selectTop',
        title: action === 'selectTop' ? `Top 1000 · ${node.name ?? node.label}` : undefined,
      })
    } catch (error) {
      setExplorerError(error instanceof ToolError ? error.message : 'Couldn’t script that object.')
    }
  }

  function openTool(tool: string) {
    if (TOOLS[tool]) {
      addDocument({ kind: 'tool', tool })
    } else {
      // The engine offers a tool this db-core doesn't have: db-core is older than the engine.
      setExplorerError(`This version of the database tab can't open “${tool}” yet. Update the db-core plugin.`)
    }
  }

  return (
    <div className="nk-db-workspace" ref={workspaceRef}>
      <aside className="nk-db-explorer" aria-label="Object Explorer" style={{ width: explorerWidth }}>
        <div className="nk-db-pane-title">Object Explorer</div>
        {explorerError ? (
          <p className="nk-db-pane-error" role="alert">
            {explorerError}
          </p>
        ) : null}
        <ObjectExplorer
          client={client}
          engine={engine}
          server={server}
          onNewQuery={(database) => addDocument({ kind: 'query', sql: '', database })}
          onScript={(node, action) => void script(node, action)}
          onOpenTool={openTool}
        />
      </aside>
      <Splitter
        direction="columns"
        label="Resize Object Explorer"
        value={explorerWidth}
        min={MIN_EXPLORER_WIDTH}
        max={maxWidth}
        onMove={(x) => resizeExplorer(x - (workspaceRef.current?.getBoundingClientRect().left ?? 0))}
        onStep={(direction, big) => resizeExplorer(explorerWidth + direction * (big ? 80 : 16))}
        onReset={() => resizeExplorer(DEFAULT_EXPLORER_WIDTH)}
      />

      <section className="nk-db-documents">
        <div className="nk-db-doc-tabs" role="tablist" aria-label="Query windows">
          {documents.map((document) => (
            <div key={document.id} className="nk-db-doc-tab" data-active={document.id === activeDocument ? '' : undefined}>
              <button type="button" role="tab" aria-selected={document.id === activeDocument} onClick={() => setActiveDocument(document.id)}>
                {document.title}
              </button>
              <button type="button" className="nk-db-doc-close" onClick={() => closeDocument(document.id)} aria-label={`Close ${document.title}`}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="nk-db-button" data-ghost="" onClick={() => addDocument({ kind: 'query', sql: '' })}>
            + New Query
          </button>
        </div>
        {documents.length === 0 ? (
          <div className="nk-db-empty">
            <p>No query windows open.</p>
            <button type="button" className="nk-db-button" onClick={() => addDocument({ kind: 'query', sql: '' })}>
              New Query
            </button>
          </div>
        ) : null}
        {documents.map((document) =>
          document.kind === 'query' ? (
            <QueryWindow
              key={document.id}
              client={client}
              engine={engine}
              title={document.title}
              target={target}
              databases={databases}
              initialSql={document.sql}
              initialDatabase={document.database}
              runOnOpen={document.runOnOpen}
              active={visible && document.id === activeDocument}
            />
          ) : (
            <BlockingManager
              key={document.id}
              client={client}
              engine={engine}
              active={visible && document.id === activeDocument}
              onOpenQuery={(sql) => addDocument({ kind: 'query', sql })}
            />
          ),
        )}
      </section>
    </div>
  )
}
