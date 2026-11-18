import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { ToolError, type ToolClient } from './client'
import { bracketName, copyText } from './format'
import { SCRIPT_LABELS, type DatabaseEngineInfo, type ScriptAction, type ServerInfo, type SqlObjectNode } from './types'
import { Menu, Spinner, type MenuEntry } from './ui'

interface ObjectExplorerProps {
  client: ToolClient
  engine: DatabaseEngineInfo
  server: ServerInfo
  onNewQuery: (database?: string) => void
  onScript: (node: SqlObjectNode, action: ScriptAction) => void
  /** Opens a tool from Management (the blocking manager). */
  onOpenTool: (name: string) => void
}

/** A node where it is in the tree: its path is its identity (names repeat across databases and tables). */
interface Placed {
  key: string
  node: SqlObjectNode
  depth: number
}

const ROOT_KEY = 'server'

function childKey(parent: string, node: SqlObjectNode): string {
  return `${parent}/${node.kind}:${node.objectId ?? node.name ?? node.label}`
}

/** Folders, drawn a little stronger: nodes that hold others and aren't an object of their own. */
function isFolder(node: SqlObjectNode): boolean {
  return node.expandable && !node.name
}

/**
 * The object explorer, as in SSMS (ported from 1.x): the server, then what the engine's explorer lists under it,
 * loaded when a node is first expanded. Right-click (or Shift+F10) for the node's scripts, New Query and Copy name.
 */
export function ObjectExplorer({ client, engine, server, onNewQuery, onScript, onOpenTool }: ObjectExplorerProps) {
  const root: SqlObjectNode = {
    kind: 'server',
    label: `${server.serverName} (${engine.product} ${server.productVersion} - ${server.login})`,
    expandable: true,
  }
  const [children, setChildren] = useState<Record<string, SqlObjectNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [focused, setFocused] = useState(ROOT_KEY)
  const [menu, setMenu] = useState<{ x: number; y: number; placed: Placed } | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  async function load(key: string, node: SqlObjectNode) {
    setLoading((current) => new Set(current).add(key))
    setErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    try {
      const list = await client.request<SqlObjectNode[]>('explore', { node: key === ROOT_KEY ? { kind: 'server', label: '', expandable: true } : node })
      setChildren((current) => ({ ...current, [key]: list }))
    } catch (error) {
      setErrors((current) => ({ ...current, [key]: error instanceof ToolError ? error.message : 'Couldn’t load this.' }))
    } finally {
      setLoading((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  useEffect(() => {
    void load(ROOT_KEY, root)
    // The root loads once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  function toggle(placed: Placed, open?: boolean) {
    if (!placed.node.expandable) {
      return
    }
    const isOpen = expanded.has(placed.key)
    const next = open ?? !isOpen
    if (next === isOpen) {
      return
    }
    setExpanded((current) => {
      const set = new Set(current)
      if (next) {
        set.add(placed.key)
      } else {
        set.delete(placed.key)
      }
      return set
    })
    if (next && !children[placed.key]) {
      void load(placed.key, placed.node)
    }
  }

  function refresh(placed: Placed) {
    setExpanded((current) => new Set(current).add(placed.key))
    void load(placed.key, placed.node)
  }

  /** Double-click or Enter: open a tool, else expand or collapse. */
  function activate(placed: Placed) {
    if (placed.node.tool) {
      onOpenTool(placed.node.tool)
    } else {
      toggle(placed)
    }
  }

  // The visible nodes in order, for drawing and for arrow-key movement.
  const visible: Placed[] = []
  const walk = (key: string, node: SqlObjectNode, depth: number) => {
    visible.push({ key, node, depth })
    if (expanded.has(key)) {
      for (const child of children[key] ?? []) {
        walk(childKey(key, child), child, depth + 1)
      }
    }
  }
  walk(ROOT_KEY, root, 0)

  function focusKey(key: string) {
    setFocused(key)
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus())
  }

  function onKeyDown(event: KeyboardEvent, placed: Placed) {
    const index = visible.findIndex((v) => v.key === placed.key)
    const nextNode = visible[index + 1]
    if (event.key === 'ArrowDown' && nextNode) {
      event.preventDefault()
      focusKey(nextNode.key)
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      focusKey(visible[index - 1]!.key)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (placed.node.expandable && !expanded.has(placed.key)) {
        toggle(placed, true)
      } else if (nextNode && nextNode.depth > placed.depth) {
        focusKey(nextNode.key)
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (expanded.has(placed.key)) {
        toggle(placed, false)
      } else {
        const parent = visible
          .slice(0, index)
          .reverse()
          .find((v) => v.depth < placed.depth)
        if (parent) {
          focusKey(parent.key)
        }
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      activate(placed)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      setMenu({ x: rect.left + 24, y: rect.bottom, placed })
    } else if (event.key === 'F5') {
      event.preventDefault()
      if (placed.node.expandable) {
        refresh(placed)
      }
    }
  }

  function openMenu(event: MouseEvent, placed: Placed) {
    event.preventDefault()
    setFocused(placed.key)
    setMenu({ x: event.clientX, y: event.clientY, placed })
  }

  function menuEntries(placed: Placed): MenuEntry[] {
    const { node } = placed
    const entries: MenuEntry[] = [{ kind: 'header', label: node.label }]
    if (node.tool) {
      entries.push({ kind: 'item', label: 'Open', onSelect: () => onOpenTool(node.tool!) })
    }
    if (node.kind === 'server' || node.kind === 'database') {
      entries.push({ kind: 'item', label: 'New Query', onSelect: () => onNewQuery(node.kind === 'database' ? (node.name ?? undefined) : undefined) })
    }
    for (const action of node.scripts ?? []) {
      entries.push({ kind: 'item', label: SCRIPT_LABELS[action] ?? action, onSelect: () => onScript(node, action) })
    }
    if (node.name && !node.tool) {
      const name = (engine.quote ?? bracketName)(node)
      entries.push({ kind: 'item', label: 'Copy name', detail: name, onSelect: () => copyText(name) })
    }
    if (node.expandable) {
      entries.push({ kind: 'separator' }, { kind: 'item', label: 'Refresh', detail: 'F5', onSelect: () => refresh(placed) })
    }
    return entries
  }

  return (
    <>
      <ul className="nk-db-tree" role="tree" aria-label="Objects" ref={treeRef}>
        {visible.map((placed) => {
          const { key, node, depth } = placed
          const isOpen = expanded.has(key)
          return (
            <li
              key={key}
              role="treeitem"
              aria-expanded={node.expandable ? isOpen : undefined}
              aria-level={depth + 1}
              aria-selected={focused === key}
              data-key={key}
              tabIndex={focused === key ? 0 : -1}
              className="nk-db-tree-item"
              style={{ paddingLeft: `${depth * 14 + 4}px` }}
              onClick={() => setFocused(key)}
              onDoubleClick={() => activate(placed)}
              onKeyDown={(event) => onKeyDown(event, placed)}
              onContextMenu={(event) => openMenu(event, placed)}
            >
              <span
                className="nk-db-caret"
                onClick={(event) => {
                  event.stopPropagation()
                  setFocused(key)
                  toggle(placed)
                }}
                aria-hidden="true"
              >
                {node.expandable ? (isOpen ? '▾' : '▸') : ''}
              </span>
              <span className={isFolder(node) ? 'nk-db-folder' : undefined}>{node.label}</span>
              {node.detail ? <span className="nk-db-detail"> ({node.detail})</span> : null}
              {loading.has(key) ? <Spinner /> : null}
              {errors[key] ? (
                <span className="nk-db-tree-error" role="alert">
                  {errors[key]}
                </span>
              ) : null}
              {isOpen && children[key]?.length === 0 && !loading.has(key) ? <span className="nk-db-detail"> (empty)</span> : null}
            </li>
          )
        })}
      </ul>
      {menu ? <Menu label={`Actions for ${menu.placed.node.label}`} entries={menuEntries(menu.placed)} x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
    </>
  )
}
