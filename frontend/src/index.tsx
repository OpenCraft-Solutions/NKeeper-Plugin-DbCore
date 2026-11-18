import { adoptStyles, definePlugin } from '@nkeeper/sdk'
import { DatabaseView } from './DatabaseView'
import { databaseStyles } from './ui'

export type { DatabaseViewProps } from './DatabaseView'
export type { DatabaseEngineInfo, SqlObjectNode } from './types'

/**
 * db-core's frontend (docs/architecture.md §7.32): it draws no tab of its own, and shares the database tab with the
 * engine plugins that depend on it (SDK 1.8), which wrap it in their session types' views:
 *
 * ```tsx
 * let shared: { DatabaseView: ComponentType<DatabaseViewProps> }
 * activate(context) { shared = context.use('db-core') as typeof shared }
 * sessionViews: { mssql: (props) => <shared.DatabaseView {...props} engine={SQL_SERVER} /> }
 * ```
 */
const plugin = definePlugin({
  id: 'db-core',
  activate() {
    // Constructable stylesheets: the shell's policy blocks <style> elements (docs/architecture.md §7.14).
    adoptStyles(databaseStyles)
  },
  exports: { DatabaseView },
})

export default plugin
