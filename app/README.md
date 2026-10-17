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
already running and opens the viewer as a tab in your default browser. The
server runs in the background and logs to `~/Library/Logs/kb25-viewer.log`;
the power button in the top-right corner quits it, and it also quits by itself
30 seconds after its last tab closes. Re-run `npm run app:install` after moving
the checkout or switching Node versions.

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
| `KB25_UPDATE_CHECK` | on    | Installed copies check GitHub for a newer release (at most every 6 hours) and offer an Update button. `0` turns that off. |
| `KB25_RELEASES_URL` | the GitHub releases | Where that check and the update look. For testing updates against a local copy. |
| `KB25_FEEDBACK_RELAY` | the feedback relay | Where the feedback dialog's reports go: a relay built from [`@elmir-mamedov/feedback`](https://github.com/elmir-mamedov/feedback). For testing against `wrangler dev` (`http://localhost:8787`). |
| `KB25_CLAUDE_PATH` | searched | The `claude` program the chat runs. Unset, the viewer looks on `PATH` and in the usual install folders; set, it uses only this. |

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
- Searches the current space from the sidebar box (Cmd/Ctrl+K), optionally
  narrowed to pages carrying chosen labels.
- Labels pages: the ⋯ menu's "Labels" sets coloured markers such as "Draft" or
  "Needs review". A page lists their names in frontmatter (`labels: [Draft]`);
  each space's palette, `<space>/_labels.json`, owns their colours (ten named
  swatches). Labels show as chips under the page title and dots in the sidebar.
- Opens a Dashboards hub per space from the chart button in the corner
  (`/_dashboard?space=<key>`):
  - `/_dashboard/tasks` — open task notes, grouped by page.
  - `/_dashboard/labels` — pages filtered by label (a page must carry every
    ticked one) and searched; the state is in the URL. Labels are created,
    renamed, recoloured and deleted here, and a rename or delete rewrites every
    page carrying the label, archived ones included, in one commit.
- Shows the page's last-updated date from `git log` (falls back gracefully).
- Edits existing pages in the browser at `/_edit/<slug>`.
- Validates frontmatter before saving.
- Auto-commits saved page changes in the `kb/` Git repo as
  `Update <path>.md via web`.
- Serves attachments from `kb/_assets/` at `/_assets/...`.
- Sends feedback to the developer from the corner's speech-bubble dialog:
  a message, screenshots and opt-in diagnostics, through the shared feedback
  relay ([`@elmir-mamedov/feedback`](https://github.com/elmir-mamedov/feedback)
  draws the dialog and runs the relay). Reports that can't go yet wait in a
  `feedback-outbox` folder (in KB25's home when installed, else
  `~/.config/kb25/`) and are retried.

## Chat

The sparkles button in the corner opens a chat drawer on every page. It runs
the person's own Claude Code non-interactively (`claude -p`), one process per
message, with the kb25 MCP server attached, so the chat can answer questions
and, when asked in so many words or with the **Write to KB** toggle, write
pages. It needs Claude Code 2.1.259 or newer, installed and signed in; the
drawer says so when it is not.

- `src/claude-cli.ts` finds `claude` (a launcher-started server has a bare
  `PATH`, so the usual install folders are searched too), checks it, and runs a
  turn: `--session-id` starts a thread's session and `--resume` continues it;
  `--strict-mcp-config` attaches kb25 alone; `--tools WebSearch,WebFetch`
  leaves no shell or file tools; `--setting-sources project`, from an empty
  working folder, keeps the person's plugins and hooks out while still using
  their sign-in (`--bare` would not, and `--safe-mode` drops `--mcp-config`).
- `src/chat.ts` runs turns on the server, so one survives the page that started
  it: a page that loads mid-turn replays it from `/_chat/threads/<id>/events`.
  It also holds the system prompt. When a turn writes, the server reads its
  kb25 tool calls and appends a report of the pages created, updated, moved or
  deleted, with links; the model only adds a caveat.
- `src/chat-store.ts` keeps each thread as JSON in `<KB_DIR>/.kb25/chat/threads`,
  beside the spaces rather than in one, so no space commits a conversation.
- The chat's MCP server commits as `... via chat` (`KB25_COMMIT_VIA=chat`).
- A launcher-started server does not quit after its last tab closes while a
  turn is still running; it waits for the turn to end.

## MCP server

The MCP server runs over stdio and exposes the same Markdown knowledge base to
MCP clients for both reading and writing. Every write is auto-committed in the
`kb/` Git repo as `... via mcp` (mirroring the web editor's `... via web`).
`KB25_COMMIT_VIA` changes that suffix; the viewer's chat starts its copy with
`chat`, so its edits commit as `... via chat`.

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
