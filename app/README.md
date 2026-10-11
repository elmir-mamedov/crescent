# KB Viewer

A lean web viewer/editor for the markdown knowledge base in `../kb`. Node +
TypeScript + Fastify. No build step — TypeScript runs directly via `tsx` (the
kb25 plugin's bundled MCP server aside; see below).

## Run

```bash
cp ../.env.example ../.env   # fill in the AUTH_* trio; the server exits without it
cd app
npm install
npm run dev      # http://localhost:4000, auto-reloads on file changes
npm run mcp      # stdio MCP server for local agent/client integrations
```

On macOS, `npm run app:install` adds `~/Applications/KB25.app`, so the viewer
opens like any other app (Cmd+Space, "KB25"). It starts the server if it is not
already running and opens the viewer as a tab in your default browser; the
server keeps running in the background until logout and logs to
`~/Library/Logs/kb25-viewer.log`. Re-run it after moving the checkout or
switching Node versions.

It binds to `localhost` only, so nothing outside this machine can reach it.
Keep it that way. Sign-in is one static username/password: repeated wrong
answers cost that caller a cooldown, which slows guessing without making the
form safe to publish, and a wider bind puts it on the network in cleartext
unless something in front of it terminates TLS. To share a knowledge base with
the team, give each person their own copy and let the
`kb/` space repos sync through their own git remotes (`KB_SYNC=1`) rather than
pointing everyone at one exposed process.

## Configuration (env vars)

| Var          | Default        | Meaning                                  |
|--------------|----------------|------------------------------------------|
| `KB_DIR`     | `../kb`        | Path to the content folder. The MCP server also reads it from `~/.config/kb25/.env`. |
| `PORT`       | `4000`         | Port to listen on.                       |
| `HOST`       | `localhost`    | Bind address. Leave it — a wider bind exposes the login form (see Run). |
| `SITE_TITLE` | `Knowledge Base` | Name shown in the sidebar/title.       |
| `AUTH_USERNAME` | required   | Username for browser sign-in.            |
| `AUTH_PASSWORD` | required   | Password for browser sign-in.            |
| `AUTH_SESSION_SECRET` | required | Secret used to sign session cookies. |
| `TRUST_PROXY` | off          | Believe `x-forwarded-*`. Only behind a real reverse proxy. |

```bash
KB_DIR=/path/to/kb PORT=8080 SITE_TITLE="Team Wiki" npm start
```

The session cookie is `HttpOnly` and `SameSite=Lax`, and picks up `Secure` when
the request arrives over HTTPS. Behind a proxy that terminates TLS, set
`TRUST_PROXY=1` so `x-forwarded-proto` and `x-forwarded-for` are believed — the
viewer reads the first to know it is on HTTPS and the second to tell callers
apart for the sign-in cooldown. Leave it off otherwise: unproxied, a caller
writes those headers itself.

## What it does

- Walks `kb/` and builds the sidebar tree (folder + `index.md` = a section).
- Requires sign-in before viewing or editing pages.
- Renders each `.md` page: frontmatter title + tags, markdown body, `[[wiki-links]]`,
  code highlighting.
- Gives every heading an anchor, a hover `#` that copies `space/page#anchor`, and an
  "On this page" rail listing the page's `##`/`###` sections.
- Carries inline notes: select a phrase and leave a `task`, `remark` or `highlight`
  on it, stored as a comment in the page's own Markdown. An `agent` note is the
  fourth kind — written over MCP, drawn pink, and resolve-only in the browser.
- Shows the page's last-updated date from `git log` (falls back gracefully).
- Edits existing pages in the browser at `/_edit/<slug>`.
- Validates frontmatter before saving.
- Auto-commits saved page changes in the `kb/` Git repo as
  `Update <path>.md via web`.
- Serves attachments from `kb/_assets/` at `/_assets/...`.

## MCP server

The MCP server runs over stdio and exposes the same Markdown knowledge base to
MCP clients for both reading and writing. Every write is auto-committed in the
`kb/` Git repo as `... via mcp` (mirroring the web editor's `... via web`).

```bash
cd app
npm run mcp
```

Read tools:

- `kb_list_spaces` — returns the spaces (top-level containers). Supports `filter`.
- `kb_get_space_instructions` — reads a space's standing instructions and its
  write token.
- `kb_list_pages` — returns the navigation tree. Supports `filter`:
  `live`, `archived`, or `all`, and `space`.
- `kb_get_page` — reads one page by slug. Supports `format`: `parsed` or `raw`.
  The parsed form lists the page's `sections` with the anchor each heading links by.
- `kb_list_notes` — returns the inline notes left on pages. Supports `slug`,
  `space`, `kind`, `filter` and `limit`.
- `kb_search` — searches titles, slugs, tags, summaries, and Markdown body text.
  A body hit also reports the `section` it fell under.

Write tools (auto-commit to Git):

- `kb_create_page` — single-shot create from `parent` + `title` + `body`
  (optional `tags`, `summary`).
- `kb_create_folder` — create a section (a folder with its own `index.md`).
- `kb_rename_folder` — rename a section, moving the pages under it.
- `kb_update_page` — replace a page's full raw Markdown (frontmatter validated).
- `kb_add_agent_note` — leave a pink note on the block containing a quoted
  passage. Refuses a quote it cannot find, or finds in more than one block.
- `kb_resolve_agent_note` — take back one of those notes by id. Agent notes only;
  a person's note is closed by addressing it in a `kb_update_page` call.
- `kb_archive_page` / `kb_restore_page` — toggle archived frontmatter flags
  (reversible; works on section subtrees).
- `kb_move_page` — move a page or section under a new parent (collisions auto-suffix).
- `kb_rename_page` — change a page's URL slug (its last path segment) in place.
- `kb_delete_page` — permanently delete a page or section subtree.
- `kb_create_space` — create a new top-level space with its own `index.md`.

> The stdio server has no auth, so it trusts its local client with these writes.
> If it is ever exposed beyond a single trusted user, gate the write tools.

Resources:

- `kb://page/{+slug}` — read raw Markdown for a page as `text/markdown`.

Example Claude / Claude Desktop config:

```json
{
  "mcpServers": {
    "kb25": {
      "command": "/Users/elmir.mamedov/dev/flux/app/node_modules/.bin/tsx",
      "args": ["/Users/elmir.mamedov/dev/flux/app/src/mcp.ts"],
      "env": {
        "KB_DIR": "/Users/elmir.mamedov/dev/flux/kb"
      }
    }
  }
}
```

Example Codex CLI config (`~/.codex/config.toml`):

```toml
[mcp_servers.kb25]
command = "/Users/elmir.mamedov/dev/flux/app/node_modules/.bin/tsx"
args = ["/Users/elmir.mamedov/dev/flux/app/src/mcp.ts"]

[mcp_servers.kb25.env]
KB_DIR = "/Users/elmir.mamedov/dev/flux/kb"
```

### As the kb25 plugin

`kb25-plugin/` is a Claude plugin: the page-authoring skill plus this MCP server,
bundled into one file (`kb25-plugin/server/mcp.mjs`) so that it runs on plain
`node` once installed, without this checkout or its `node_modules`. The bundle is
a build output, git-ignored and never committed, so build it before installing
or reinstalling the plugin from this checkout:

```bash
cd app
npm run build:plugin
```

To give the plugin to someone else (for example to install in Cowork), package
it. This rebuilds the bundle and writes `dist/kb25-<version>.zip`, taking the
version from `kb25-plugin/.claude-plugin/plugin.json` — bump it for each release:

```bash
cd app
npm run package:plugin
```

An installed plugin runs from the client's plugin cache, so it cannot find `kb/`
relative to itself. Tell it once per machine where the knowledge base lives:

```bash
mkdir -p ~/.config/kb25
echo 'KB_DIR=/absolute/path/to/kb' > ~/.config/kb25/.env
```

The server reads that file after the checkout's own `.env` files, and a real
environment variable still wins over all of them. When `KB_DIR` does not exist
it refuses to start, rather than serve an empty knowledge base. The KB25
installer reads that file too, and offers to use the knowledge base it names.

## Scripts

- `npm run dev` — watch + reload.
- `npm start` — run once.
- `npm run app:install` — install the `KB25.app` launcher (macOS).
- `npm run typecheck` — type-check with `tsc --noEmit`.
- `npm run build:plugin` — bundle the MCP server into `kb25-plugin/server/`.
- `npm run package:plugin` — rebuild the bundle and zip the plugin into `dist/`.

## Not yet (later steps)

Web UI search.
