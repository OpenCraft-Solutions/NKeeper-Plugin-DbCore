import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { copyText, displayValue, tabSeparated } from './format'
import type { SqlOutput } from './types'
import { Menu, type MenuEntry } from './ui'

/** Rows drawn at first; more on request (a result set can have 10,000). */
const PAGE = 500

/**
 * One result set as a grid, as in SSMS: row numbers, NULLs dimmed, numbers right-aligned. Click a cell to select it;
 * Ctrl+C or right-click copies it, its row, or everything with the headers.
 */
export function ResultGrid({ output, label }: { output: SqlOutput; label: string }) {
  const columns = output.columns ?? []
  const rows = output.rows ?? []
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<[number, number] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; column: number } | null>(null)
  const header = columns.map((c) => c.name)
  const cell = (row: number, column: number) => displayValue(rows[row]?.[column])

  function menuEntries(row: number, column: number): MenuEntry[] {
    return [
      { kind: 'item', label: 'Copy', detail: 'Ctrl+C', onSelect: () => copyText(cell(row, column)) },
      { kind: 'item', label: 'Copy row', onSelect: () => copyText(tabSeparated([rows[row] ?? []])) },
      { kind: 'item', label: 'Copy with headers', detail: `${rows.length.toLocaleString()} rows`, onSelect: () => copyText(tabSeparated(rows, header)) },
      { kind: 'item', label: 'Copy column name', onSelect: () => copyText(header[column] ?? '') },
    ]
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selected) {
      return
    }
    const [row, column] = selected
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      copyText(cell(row, column))
      return
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      setSelected([Math.min(Math.max(row + move[0], 0), Math.min(rows.length, shown) - 1), Math.min(Math.max(column + move[1], 0), columns.length - 1)])
    }
  }

  function openMenu(event: MouseEvent, row: number, column: number) {
    event.preventDefault()
    setSelected([row, column])
    setMenu({ x: event.clientX, y: event.clientY, row, column })
  }

  return (
    <div className="nk-db-grid" tabIndex={0} onKeyDown={onKeyDown} role="region" aria-label={label}>
      <table>
        <thead>
          <tr>
            <th scope="col" aria-label="Row" />
            {columns.map((column, i) => (
              <th key={i} scope="col" title={column.type} className={column.numeric ? 'nk-db-numeric' : undefined}>
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((row, r) => (
            <tr key={r}>
              <th scope="row">{r + 1}</th>
              {row.map((value, c) => (
                <td
                  key={c}
                  className={columns[c]?.numeric ? 'nk-db-numeric' : undefined}
                  data-null={value === null ? '' : undefined}
                  data-selected={selected?.[0] === r && selected[1] === c ? '' : undefined}
                  onClick={() => setSelected([r, c])}
                  onContextMenu={(event) => openMenu(event, r, c)}
                  title={value !== null && value.length > 60 ? value.slice(0, 2000) : undefined}
                >
                  {displayValue(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown ? (
        <button type="button" className="nk-db-more" onClick={() => setShown((n) => n + PAGE * 4)}>
          Show more rows ({(rows.length - shown).toLocaleString()} not drawn yet)
        </button>
      ) : null}
      {output.truncated ? (
        <p className="nk-db-truncated">
          Showing the first {rows.length.toLocaleString()} of {(output.rowCount ?? rows.length).toLocaleString()} rows. Narrow the query to see the rest.
        </p>
      ) : null}
      {menu ? <Menu label="Result cell" entries={menuEntries(menu.row, menu.column)} x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}
