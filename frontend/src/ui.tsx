import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

/**
 * The database tab's styles, adopted when db-core activates: 1.x's SSMS-like look, on the shell's design tokens,
 * each with a fallback (docs/architecture.md §7.14).
 */
export const databaseStyles = `
.nk-db { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--color-bg, #0b1220);
  color: var(--color-text, #e5ebf5); font-family: var(--font-sans, system-ui, sans-serif); font-size: 0.875rem; }
.nk-db-status { display: flex; align-items: center; gap: 0.5rem; min-height: 2.25rem; padding: 0.25rem 1rem;
  background: var(--color-surface, #111a2e); border-bottom: 1px solid var(--color-border, #233150); font-size: 0.8125rem; }
.nk-db-dot { width: 0.5rem; height: 0.5rem; flex-shrink: 0; border-radius: 999px; background: var(--color-text-subtle, #7d8ba6); }
.nk-db-dot[data-state='connecting'] { background: var(--color-warning, #f5b84b); }
.nk-db-dot[data-state='open'] { background: #4ade80; }
.nk-db-dot[data-state='ended'] { background: #f87171; }
.nk-db-status-text { font-weight: 550; }
.nk-db-muted { color: var(--color-text-muted, #9aa8c1); }
.nk-db-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-left: auto; }
.nk-db-area { position: relative; flex: 1; min-height: 0; display: flex; }
.nk-db-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 1rem; }
.nk-db-card { display: flex; flex-direction: column; gap: 0.75rem; max-width: 32rem; padding: 1.25rem 1.5rem;
  background: var(--color-surface, #111a2e); border: 1px solid var(--color-border-strong, #33456b); border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-card, 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.25)); font-size: 0.9375rem; }
.nk-db-card[data-error] { border-color: var(--color-danger-border, #b91c1c); }
.nk-db-card-row { flex-direction: row; align-items: center; }
.nk-db-card h3 { margin: 0; font-size: 1.0625rem; font-weight: 620; }
.nk-db-card p { margin: 0; }
.nk-db-card-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
.nk-db-spinner { display: inline-block; width: 0.875rem; height: 0.875rem; border: 2px solid var(--color-border-strong, #33456b);
  border-top-color: var(--color-accent-text, #8fb4ff); border-radius: 999px; animation: nk-db-spin 0.8s linear infinite; vertical-align: middle; }
@keyframes nk-db-spin { to { transform: rotate(360deg); } }
.nk-db-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; min-height: 1.75rem; padding: 0 0.625rem;
  border: 1px solid var(--color-border-strong, #33456b); border-radius: var(--radius-md, 8px); background: transparent;
  color: var(--color-text, #e5ebf5); font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.nk-db-button:hover:not(:disabled) { background: var(--color-surface-raised, #16213a); border-color: var(--color-border-hover, #46598a); }
.nk-db-button:disabled { opacity: 0.5; cursor: default; }
.nk-db-button[data-primary] { background: var(--color-accent, #2563eb); border-color: var(--color-accent, #2563eb); color: var(--color-on-accent, #fff); }
.nk-db-button[data-danger] { border-color: var(--color-danger-border, #b91c1c); color: var(--color-danger-text, #fca5a5); }
.nk-db-button[data-ghost] { border-color: transparent; }
.nk-db-workspace { display: flex; flex: 1; min-width: 0; min-height: 0; }
.nk-db-explorer { display: flex; flex-direction: column; flex-shrink: 0; min-height: 0; background: var(--color-surface, #111a2e);
  border-right: 1px solid var(--color-border, #233150); }
.nk-db-pane-title { padding: 0.375rem 0.75rem; font-size: 0.75rem; font-weight: 650; letter-spacing: 0.02em; text-transform: uppercase;
  color: var(--color-text-muted, #9aa8c1); border-bottom: 1px solid var(--color-border, #233150); }
.nk-db-pane-error { margin: 0.5rem; color: var(--color-danger-text, #fca5a5); font-size: 0.8125rem; }
.nk-db-tree { flex: 1; margin: 0; padding: 0.25rem 0; overflow: auto; list-style: none; font-size: 0.8125rem; }
.nk-db-tree-item { display: flex; align-items: center; gap: 0.25rem; min-height: 1.5rem; padding-right: 0.5rem; white-space: nowrap; cursor: default; outline: none; }
.nk-db-tree-item:hover { background: var(--color-surface-raised, #16213a); }
.nk-db-tree-item[aria-selected='true'] { background: var(--color-accent-soft, #1e3a6e); }
.nk-db-tree-item:focus-visible { box-shadow: inset 0 0 0 1px var(--color-accent-text, #8fb4ff); }
.nk-db-caret { display: inline-block; width: 1rem; text-align: center; color: var(--color-text-muted, #9aa8c1); cursor: pointer; }
.nk-db-folder { color: var(--color-text, #e5ebf5); font-weight: 550; }
.nk-db-detail { color: var(--color-text-muted, #9aa8c1); }
.nk-db-tree-error { margin-left: 0.5rem; color: var(--color-danger-text, #fca5a5); white-space: normal; }
.nk-db-splitter-columns { width: 5px; flex-shrink: 0; cursor: col-resize; background: transparent; }
.nk-db-splitter-rows { height: 5px; flex-shrink: 0; cursor: row-resize; background: var(--color-border, #233150); }
.nk-db-splitter-columns:hover, .nk-db-splitter-rows:hover, .nk-db-splitter-columns:focus-visible, .nk-db-splitter-rows:focus-visible {
  background: var(--color-accent, #2563eb); outline: none; }
.nk-db-documents { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.nk-db-doc-tabs { display: flex; flex-shrink: 0; overflow-x: auto; background: var(--color-surface, #111a2e); border-bottom: 1px solid var(--color-border, #233150); }
.nk-db-doc-tab { display: flex; align-items: center; border-right: 1px solid var(--color-border, #233150); }
.nk-db-doc-tab[data-active] { background: var(--color-bg, #0b1220); box-shadow: inset 0 2px 0 var(--color-accent, #2563eb); }
.nk-db-doc-tab button { padding: 0.375rem 0.5rem 0.375rem 0.75rem; border: 0; background: none; color: inherit; font: inherit; font-size: 0.8125rem; cursor: pointer; white-space: nowrap; }
.nk-db-doc-tab .nk-db-doc-close { padding: 0.25rem 0.5rem; color: var(--color-text-muted, #9aa8c1); }
.nk-db-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; flex: 1; color: var(--color-text-muted, #9aa8c1); }
.nk-db-window { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.nk-db-window[hidden], .nk-db-tool[hidden] { display: none; }
.nk-db-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; border-bottom: 1px solid var(--color-border, #233150); }
.nk-db-field { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--color-text-muted, #9aa8c1); }
.nk-db-field select { min-height: 1.75rem; max-width: 16rem; padding: 0 0.375rem; border: 1px solid var(--color-border-strong, #33456b);
  border-radius: var(--radius-md, 8px); background: var(--color-input-bg, #0b1220); color: var(--color-text, #e5ebf5); font: inherit; font-size: 0.8125rem; }
.nk-db-segmented { display: inline-flex; border: 1px solid var(--color-border-strong, #33456b); border-radius: var(--radius-md, 8px); overflow: hidden; }
.nk-db-segmented button { padding: 0.25rem 0.625rem; border: 0; background: none; color: inherit; font: inherit; font-size: 0.8125rem; cursor: pointer; }
.nk-db-segmented button[aria-pressed='true'] { background: var(--color-surface-raised, #16213a); font-weight: 600; }
.nk-db-note { color: var(--color-text-muted, #9aa8c1); font-size: 0.75rem; }
.nk-db-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.5rem 0.75rem; padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-strong, #33456b); border-radius: var(--radius-md, 8px); background: var(--color-surface, #111a2e); }
.nk-db-notice[data-error] { border-color: var(--color-danger-border, #b91c1c); color: var(--color-danger-text, #fca5a5); }
.nk-db-notice > span { flex: 1; }
.nk-db-editor { display: flex; min-height: 3rem; overflow: hidden; flex-basis: 0; }
.nk-db-gutter { flex-shrink: 0; min-width: 2.75rem; padding: 0.5rem 0.5rem 0.5rem 0; overflow: hidden; text-align: right;
  color: var(--color-text-subtle, #7d8ba6); background: var(--color-surface, #111a2e); font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.8125rem; line-height: 1.25rem; user-select: none; }
.nk-db-code { flex: 1; min-width: 0; padding: 0.5rem; border: 0; outline: none; resize: none; background: var(--color-bg, #0b1220); color: var(--color-text, #e5ebf5);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.8125rem; line-height: 1.25rem; tab-size: 4; white-space: pre; }
.nk-db-results { display: flex; flex-direction: column; min-height: 3rem; overflow: hidden; flex-basis: 0; }
.nk-db-result-tabs { display: flex; flex-shrink: 0; gap: 0.25rem; padding: 0.25rem 0.5rem 0; border-bottom: 1px solid var(--color-border, #233150); }
.nk-db-result-tabs button { padding: 0.25rem 0.75rem; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--color-text-muted, #9aa8c1);
  font: inherit; font-size: 0.8125rem; cursor: pointer; }
.nk-db-result-tabs button[aria-selected='true'] { border-bottom-color: var(--color-accent, #2563eb); color: var(--color-text, #e5ebf5); font-weight: 600; }
.nk-db-result-body { flex: 1; min-height: 0; overflow: auto; padding: 0.5rem; }
.nk-db-results-empty { margin: auto; color: var(--color-text-subtle, #7d8ba6); }
.nk-db-grid { margin-bottom: 0.75rem; overflow: auto; max-height: 100%; border: 1px solid var(--color-border, #233150); outline: none; }
.nk-db-grid:focus-visible { border-color: var(--color-accent-text, #8fb4ff); }
.nk-db-grid table, .nk-db-table { border-collapse: collapse; font-size: 0.8125rem; }
.nk-db-grid th, .nk-db-grid td { padding: 0.1875rem 0.5rem; border-right: 1px solid var(--color-border, #233150); border-bottom: 1px solid var(--color-border, #233150);
  max-width: 32rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.nk-db-grid thead th { position: sticky; top: 0; z-index: 1; background: var(--color-surface, #111a2e); font-weight: 600; }
.nk-db-grid tbody th { color: var(--color-text-subtle, #7d8ba6); font-weight: 400; background: var(--color-surface, #111a2e); text-align: right; }
.nk-db-grid td[data-null] { color: var(--color-text-subtle, #7d8ba6); font-style: italic; }
.nk-db-grid td[data-selected] { background: var(--color-accent-soft, #1e3a6e); }
.nk-db-numeric { text-align: right !important; font-variant-numeric: tabular-nums; }
.nk-db-more { margin: 0.25rem 0.5rem; padding: 0; border: 0; background: none; color: var(--color-accent-text, #8fb4ff); font: inherit; font-size: 0.8125rem; cursor: pointer; }
.nk-db-truncated { margin: 0.25rem 0.5rem; color: var(--color-warning, #f5b84b); font-size: 0.8125rem; }
.nk-db-messages { display: flex; flex-direction: column; gap: 0.25rem; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.8125rem; }
.nk-db-messages p { margin: 0; white-space: pre-wrap; }
.nk-db-error-message { display: flex; flex-direction: column; padding: 0; border: 0; background: none; color: var(--color-danger-text, #fca5a5);
  font: inherit; text-align: left; white-space: pre-wrap; cursor: default; }
.nk-db-text-results { margin: 0; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.8125rem; white-space: pre; }
.nk-db-error-text { margin: 0 0 0.5rem; color: var(--color-danger-text, #fca5a5); }
.nk-db-query-status { display: flex; flex-wrap: wrap; gap: 0 1.25rem; padding: 0.25rem 0.75rem; background: #1d4ed8; color: #fff; font-size: 0.75rem; }
.nk-db-query-status[data-warn] { background: #92400e; }
.nk-db-tool { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; padding: 0.75rem 1rem; gap: 0.75rem; }
.nk-db-tool-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.nk-db-tool-header h2 { margin: 0; font-size: 1.0625rem; font-weight: 650; }
.nk-db-tool-header p { margin: 0.125rem 0 0; color: var(--color-text-muted, #9aa8c1); font-size: 0.8125rem; }
.nk-db-report-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; font-size: 0.8125rem; }
.nk-db-report-section { border: 1px solid var(--color-border, #233150); border-radius: var(--radius-md, 8px); padding: 0.5rem 0.75rem; }
.nk-db-report-section > summary { cursor: pointer; }
.nk-db-report-section > summary h3 { display: inline; margin: 0; font-size: 0.9375rem; font-weight: 620; }
.nk-db-report-grid { max-height: 24rem; overflow: auto; margin-top: 0.5rem; }
.nk-db-report-message { margin: 0.5rem 0 0; padding: 0.5rem; overflow: auto; white-space: pre-wrap; font-size: 0.8125rem;
  border-radius: var(--radius-md, 8px); background: var(--color-surface-raised, #16213a); }
.nk-db-report-copy { padding: 0.75rem; border: 1px solid var(--color-border-strong, #33456b); border-radius: var(--radius-md, 8px); }
.nk-db-report-copy h3 { margin: 0; font-size: 0.9375rem; }
ul.nk-db-notice { flex-direction: column; align-items: flex-start; padding-left: 1.75rem; }
.nk-db-table { width: 100%; }
.nk-db-table th, .nk-db-table td { padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--color-border, #233150); text-align: left; vertical-align: top; }
.nk-db-table th { position: sticky; top: -0.75rem; background: var(--color-bg, #0b1220); font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted, #9aa8c1); }
.nk-db-table tr:focus-visible { outline: 1px solid var(--color-accent-text, #8fb4ff); outline-offset: -1px; }
.nk-db-table tr[data-lead] td { font-weight: 550; }
.nk-db-ellipsis { max-width: 18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nk-db-sql { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.75rem; }
.nk-db-chain { display: inline-block; width: 1.25rem; padding: 0; border: 0; background: none; color: var(--color-text-muted, #9aa8c1); font: inherit; cursor: pointer; }
.nk-db-badge { margin-left: 0.375rem; padding: 0 0.375rem; border-radius: 999px; font-size: 0.6875rem; font-weight: 700; background: #7f1d1d; color: #fecaca; }
.nk-db-badge[data-self] { background: #78350f; color: #fde68a; }
.nk-db-wait { display: block; color: var(--color-text-muted, #9aa8c1); font-size: 0.75rem; }
.nk-db-hint { margin: 0; color: var(--color-text-subtle, #7d8ba6); font-size: 0.75rem; }
.nk-db-menu { position: fixed; z-index: 50; min-width: 13rem; margin: 0; padding: 0.25rem 0; list-style: none; background: var(--color-surface-raised, #16213a);
  border: 1px solid var(--color-border-strong, #33456b); border-radius: var(--radius-md, 8px); box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); font-size: 0.8125rem; }
.nk-db-menu-header { padding: 0.25rem 0.75rem; overflow: hidden; color: var(--color-text-muted, #9aa8c1); font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; max-width: 20rem; }
.nk-db-menu-separator { margin: 0.25rem 0; border-top: 1px solid var(--color-border, #233150); }
.nk-db-menu button { display: flex; justify-content: space-between; gap: 1rem; width: 100%; padding: 0.3125rem 0.75rem; border: 0; background: none;
  color: inherit; font: inherit; text-align: left; cursor: pointer; }
.nk-db-menu button:hover:not(:disabled), .nk-db-menu button:focus-visible { background: var(--color-accent-soft, #1e3a6e); outline: none; }
.nk-db-menu button:disabled { opacity: 0.5; cursor: default; }
.nk-db-menu-detail { color: var(--color-text-muted, #9aa8c1); max-width: 12rem; overflow: hidden; text-overflow: ellipsis; }
.nk-db-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgb(0 0 0 / 0.5); }
.nk-db-dialog { width: min(30rem, 100%); }
.nk-db-dialog dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0; font-size: 0.8125rem; }
.nk-db-dialog dt { color: var(--color-text-muted, #9aa8c1); }
.nk-db-dialog dd { margin: 0; }
`

export type MenuEntry =
  | { kind: 'header'; label: string }
  | { kind: 'separator' }
  | { kind: 'item'; label: string; detail?: string; disabled?: boolean; onSelect: () => void }

/** A context menu at a point: arrow keys move, Escape or a click elsewhere closes it. */
export function Menu({ label, entries, x, y, onClose }: { label: string; entries: MenuEntry[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null)
  // The latest onClose, so a new function each render doesn't reopen the menu's listeners.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const close = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) {
        closeRef.current()
      }
    }
    const blur = () => closeRef.current()
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('blur', blur)
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      buttons[(index + step + buttons.length) % buttons.length]?.focus()
    }
  }

  const left = Math.max(0, Math.min(x, window.innerWidth - 240))
  const top = Math.max(0, Math.min(y, window.innerHeight - 32 * entries.length - 16))
  return (
    <ul className="nk-db-menu" role="menu" aria-label={label} ref={ref} style={{ left, top }} onKeyDown={onKeyDown}>
      {entries.map((entry, i) =>
        entry.kind === 'header' ? (
          <li key={i} className="nk-db-menu-header" role="presentation">
            {entry.label}
          </li>
        ) : entry.kind === 'separator' ? (
          <li key={i} className="nk-db-menu-separator" role="separator" />
        ) : (
          <li key={i} role="none">
            <button
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => {
                onClose()
                entry.onSelect()
              }}
            >
              <span>{entry.label}</span>
              {entry.detail ? <span className="nk-db-menu-detail">{entry.detail}</span> : null}
            </button>
          </li>
        ),
      )}
    </ul>
  )
}

interface SplitterProps {
  /** `columns`: a vertical bar between side-by-side panes; `rows`: a bar between stacked panes. */
  direction: 'columns' | 'rows'
  label: string
  value: number
  min: number
  max: number
  /** The pointer's position while dragging (clientX for columns, clientY for rows). */
  onMove: (position: number) => void
  /** Arrow keys: a step smaller (-1) or larger (1); Shift for a big step. */
  onStep: (direction: -1 | 1, big: boolean) => void
  /** Double-click: back to the default size. */
  onReset: () => void
}

/** A draggable bar between two panes, as in SSMS; the arrow keys move it too. */
export function Splitter({ direction, label, value, min, max, onMove, onStep, onReset }: SplitterProps) {
  const dragging = useRef(false)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const smaller = direction === 'columns' ? 'ArrowLeft' : 'ArrowUp'
    const larger = direction === 'columns' ? 'ArrowRight' : 'ArrowDown'
    if (event.key === smaller || event.key === larger) {
      event.preventDefault()
      onStep(event.key === smaller ? -1 : 1, event.shiftKey)
    }
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={direction === 'columns' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={direction === 'columns' ? 'nk-db-splitter-columns' : 'nk-db-splitter-rows'}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button === 0) {
          event.preventDefault()
          dragging.current = true
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }
      }}
      onPointerMove={(event) => dragging.current && onMove(direction === 'columns' ? event.clientX : event.clientY)}
      onPointerUp={(event) => {
        dragging.current = false
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to reset"
    />
  )
}

/** A modal question, such as whether to kill a session. Escape cancels unless it's busy. */
export function ConfirmDialog({ title, busy, onCancel, children, actions }: { title: string; busy: boolean; onCancel: () => void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])
  return (
    <div className="nk-db-backdrop" onKeyDown={(event) => event.key === 'Escape' && !busy && onCancel()}>
      <div className="nk-db-card nk-db-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h3>{title}</h3>
        {children}
        <div className="nk-db-card-actions">{actions}</div>
      </div>
    </div>
  )
}

export function Notice({ text, error, onClose, children }: { text: string; error?: boolean; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="nk-db-notice" data-error={error ? '' : undefined} role={error ? 'alert' : 'status'}>
      <span>{text}</span>
      {children}
      {onClose ? (
        <button type="button" className="nk-db-button" data-ghost="" onClick={onClose}>
          Dismiss
        </button>
      ) : null}
    </div>
  )
}

export function Spinner() {
  return <span className="nk-db-spinner" aria-hidden="true" />
}
