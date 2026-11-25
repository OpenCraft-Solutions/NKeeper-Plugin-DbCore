# NKeeper db-core plugin

The official `db-core` plugin for [NKeeper](https://github.com/OpenCraft-Solutions/NKeeper) 2.0: what the database engine plugins (SQL Server, Oracle, SAP ASE) share. It lives in a repository of its own and is released on its own, so releasing it isn't a release of NKeeper (NKeeper's `docs/architecture.md` §9). Its design is §7.32 there.

## What it does

db-core contributes nothing on its own. Each engine plugin (`mssql`, say) depends on it, contributes its own service type and session type, and brings its own driver; db-core runs the session and draws the tab. It needs SDK 1.8 (`>=1.8.0 <2.0.0`).

**For an engine's backend**, its one assembly, `NKeeper.Plugins.Databases`, is exported, so every engine uses db-core's copy. It is also published as a NuGet package of the same name, which engines build against:
- `IDatabaseEngine`: opens the login with the engine's driver, through core (`IConnectivity.OpenDatabaseAsync`, §7.31), and gives the engine's `IDatabaseDialect`;
- `IDatabaseDialect`: the server's SQL for the query runner, the object explorer, scripts, blocking and kill, and (1.1.0) its Management reports: `Reports` and `ReportAsync`, both optional;
- `DatabaseSessionHandler<TEngine>`: the engine's session type's handler, registered with `services.AddDatabaseEngine<TEngine>()`;
- what the dialects share, ported from 1.x: `BlockingChains`, `DbValueText`, `DbQuery`, the results' records, and the reports' `ToolReport`, `ToolSection`, `ToolScript` and `ToolReports` (a section from one query, whose error, when the server refuses it, is the section's).

**For an engine's frontend**, it exports `DatabaseView`, the database tab, ported from 1.x. The engine wraps it in its session view (`context.use('db-core')`, SDK 1.8), with what it says about itself:
- the object explorer, a level at a time, with each node's scripts;
- query windows, each on a connection of its own, with results as grids or text and messages beside them;
- the blocking manager, with kill, audited as `<engine>.kill`;
- the engine's Management reports, 1.x's: what needs attention, then each section's grids, with the scripts it offers (SQL opens in a query window, RMAN commands are shown to copy). A report only reads. The engine lists one in the explorer's Management folder as the tool `report:<name>`.

The plugin's ID is `db-core`, and it is built in: it is signed with NKeeper's official key and installed with NKeeper.

## Layout

```text
backend/        the shared assembly: the contract (Engines.cs), the session (DatabaseSession.cs), the helpers, the plugin, nkeeper-plugin.json (the manifest), the project
frontend/       the database tab: a Vite library build to dist/index.js
tests/          the session's tests, on an in-memory SQLite engine
.github/        CI and the release workflow
```

It builds against NKeeper's published SDK, never core's source:

| Package | Registry | Used for |
| --- | --- | --- |
| `NKeeper.Abstractions` | GitHub Packages (NuGet) | the backend SDK |
| `NKeeper.Plugin.Build` | GitHub Packages (NuGet) | builds, packs and signs the plugin |
| `@opencraft-solutions/nkeeper-sdk` | GitHub Packages (npm) | the frontend SDK, imported as `@nkeeper/sdk` |

## Building

You need the .NET 10 SDK (see `global.json`) and Node.js 24 (see `.nvmrc`).

GitHub Packages needs a token even for public packages. Make a GitHub personal access token that can read packages (`read:packages`) and give it to the build in the environment. It is never written to the repository:

```bash
export NUGET_USERNAME=<your GitHub user name>
export NUGET_AUTH_TOKEN=<token>
export NODE_AUTH_TOKEN=<token>
```

Then, from the repository root:

```bash
(cd frontend && npm ci && npm run lint && npm run typecheck)
dotnet restore NKeeper.Plugins.Databases.slnx
dotnet build NKeeper.Plugins.Databases.slnx --configuration Release
```

Building the plugin builds its frontend, packs `db-core-<version>.nkp` into `artifacts/plugins/` and signs it with a development key, which the build creates under `.dev/keys/` on first use. Both are ignored by git. To load the package in a development NKeeper, point `Plugins:Directory` at `artifacts/plugins` and `Plugins:DevelopmentTrustDirectory` at `.dev/keys`, with an engine plugin beside it.

Pinned versions: NuGet packages are locked in `packages.lock.json` (CI restores with `--locked-mode`), and npm packages in `frontend/package-lock.json`. Run `dotnet restore --force-evaluate` after changing a version.

## Testing

```bash
dotnet test NKeeper.Plugins.Databases.slnx --configuration Release
```

The tests run the session in process, on an in-memory SQLite database standing in for an engine, with no server. They cover:
- query windows on connections of their own, a running query cancelled, a second one refused, and a window whose connection broke;
- the explorer, scripts, the tool connection opened again, and requests it refuses;
- blocking chains, kill and its audit, the window limit, and every connection closed when the session ends.

Each engine plugin tests its dialect against a real server.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: it restores from GitHub Packages with the workflow's token, lints and type-checks the frontend, checks formatting, builds, runs the tests and packs the plugin signed with a development key, which it keeps as a build artifact.

## Releasing

1. Raise `version` in `backend/nkeeper-plugin.json` (and keep `frontend/package.json` in step), and merge it to `main`.
2. Tag the merge commit `v<version>`, for example `v1.1.0`, and push the tag.
3. `.github/workflows/release.yml` runs:
   - it checks that the tag matches the manifest's version and is on `main`, then builds and tests;
   - in the protected `release` environment, which needs an owner's approval, it packs `db-core-<version>.nkp` signed with the official key, and publishes a GitHub release with the package and its SHA-256;
   - beside it, once the build and tests pass, it publishes `NKeeper.Plugins.Databases` `<version>` to GitHub Packages, for the engines. That needs no key, so it doesn't wait for the approval.

The official key's private half, `NKEEPER_RELEASE_KEY` (a PEM), is a secret of the `release` environment. It is available only to the signing job, goes to memory-backed storage for the packing step alone, and is removed when that step ends. It is never in the repository or in a log.

NKeeper's installer picks the release up when its `deploy/plugins.lock` is updated with the new URL and SHA-256.

## License

MIT, as NKeeper. See [LICENSE](LICENSE).
