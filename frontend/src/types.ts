/**
 * What an engine plugin tells the database tab about its server (docs/architecture.md §7.32): the engine's
 * frontend passes it to db-core's `DatabaseView`.
 */
export interface DatabaseEngineInfo {
  /** The product, for headings and messages: "SQL Server". */
  readonly product: string
  /** What the toolbar's list chooses: "Database", Oracle's "Schema"; null for none. */
  readonly databaseLabel: string | null
  /** The editor's placeholder: a query to start from. */
  readonly placeholder?: string
  /** A name as a query writes it, for "Copy name": [schema].[name] for SQL Server. */
  readonly quote?: (node: SqlObjectNode) => string
  /** What a login without the right to see every session lacks, for the blocking manager's warning. */
  readonly blockingPermission?: string
}

/** What a database server says about itself. */
export interface ServerInfo {
  serverName: string
  productVersion: string
  productLevel: string | null
  edition: string | null
  login: string
  /** The connection's own session on the server: SQL Server's SPID, Oracle's SID. */
  sessionId: number
}

export interface SqlColumn {
  name: string
  type: string
  numeric: boolean
}

/** One thing a query produced, in order: a result set, "(n rows affected)", a message or an error. */
export interface SqlOutput {
  kind: 'results' | 'rows' | 'message' | 'error'
  text?: string | null
  columns?: SqlColumn[] | null
  rows?: (string | null)[][] | null
  /** Every row of a result set, including those past the ones sent; the count for "rows". */
  rowCount?: number | null
  /** More rows than were sent. */
  truncated?: boolean
  number?: number | null
  severity?: number | null
  state?: number | null
  procedure?: string | null
  /** The editor's line the error is on. */
  line?: number | null
}

export interface SqlQueryResult {
  output: SqlOutput[]
  database: string
  elapsedMs: number
  cancelled: boolean
  /** The connection broke: the window opens another when it runs again. */
  connectionLost: boolean
  hasErrors: boolean
}

export type ScriptAction = 'selectTop' | 'create' | 'execute'

/** A node of the object explorer; sent back as it is to list its children or script it. */
export interface SqlObjectNode {
  kind: string
  label: string
  detail?: string | null
  expandable: boolean
  database?: string | null
  schema?: string | null
  name?: string | null
  objectId?: number | null
  /** The scripts it offers, in the menu's order. */
  scripts?: ScriptAction[]
  /** For a tool's node: the tool it opens ("blocking"). */
  tool?: string | null
}

/** A session in a blocking chain, with the sessions it blocks under it. */
export interface BlockingSession {
  sessionId: number
  login: string | null
  host: string | null
  program: string | null
  /** Null when it isn't in a database (N/A). */
  database: string | null
  status: string | null
  openTransactions: number
  blockedBy: number | null
  command: string | null
  waitType: string | null
  waitTimeMs: number | null
  waitResource: string | null
  sql: string | null
  /** Sessions it blocks directly. */
  blocked: number
  /** Every session waiting behind it, down the chain. */
  blockedVolume: number
  blockedSessions: BlockingSession[]
  /** A blocker that isn't a session (e.g. -2, an orphaned distributed transaction): it can't be killed. */
  placeholder?: boolean
  /** Oracle's serial#: with the SID, it names the session to kill. */
  serial?: number | null
  /** It's waiting on itself: usually one of its own parallel threads, or its own I/O. */
  selfBlocking?: boolean
}

export interface BlockingReport {
  leads: BlockingSession[]
  blockedCount: number
  canSeeAllSessions: boolean
  atUtc: string
}

/** A query window's connection, as the session opened it. */
export interface OpenedWindow {
  window: string
  sessionId: number
  login: string
  database: string
  /** Why it isn't in the database it asked for. */
  warning: string | null
}

export const SCRIPT_LABELS: Record<ScriptAction, string> = {
  selectTop: 'Select Top 1000 Rows',
  create: 'Script as CREATE',
  execute: 'Script as EXECUTE',
}

/** The tools the explorer can open, by the name its node gives; an engine's explorer decides which it has. */
export const TOOLS: Record<string, { title: string }> = {
  blocking: { title: 'Blocking Manager' },
}

/** A Management report the engine offers (db-core 1.1). Its explorer node's tool is `report:<name>`. */
export interface DatabaseReportInfo {
  name: string
  label: string
  detail: string
}

/** A script a report offers: SQL opens in a query window; `copy` is shown to run elsewhere (RMAN). */
export interface ToolScript {
  label: string
  text: string
  kind: 'sql' | 'copy'
}

export interface ToolSection {
  title: string
  command: string
  results: SqlOutput[]
  error: string | null
  scripts?: ToolScript[] | null
  note?: string | null
}

export interface ToolReport {
  warnings: string[]
  sections: ToolSection[]
  atUtc: string
}

/** The prefix of a report's tool name in the explorer. */
export const REPORT_TOOL = 'report:'
