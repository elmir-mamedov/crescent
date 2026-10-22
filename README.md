# KB25

KB25 is a personal knowledge base that runs on your computer. Pages are
Markdown files in a folder you own, organised into spaces, and you browse and
edit them in your web browser. A built-in chat, driven by Claude Code or
Codex, answers questions and writes pages, and the Claude app and Claude Code
can work with the same pages through an MCP connection.

## Features

- **Spaces and pages.** Each space is a folder of Markdown files and its own
  git repository. Folders group pages into sections, and the sidebar shows the
  tree; pages are moved and reordered by dragging them.
- **Reading.** Pages render with code highlighting, math (KaTeX) and Mermaid
  diagrams. Links between pages keep working when a page is moved or renamed.
  Every heading has a link, and longer pages get an outline beside the text.
- **Editing and history.** Pages are edited in the browser as Markdown, and
  each save is committed to the space's repository. The Diff view shows a
  page's past revisions, and a page can be downloaded as a Markdown file.
- **Organising.** Labels mark pages with coloured tags such as "Draft". Search
  covers the current space and can be narrowed by label. Pages can be
  archived and restored, and pages you haven't opened yet are marked in the
  sidebar.
- **Notes.** Tasks, remarks and highlights can be attached to a passage of a
  page. A dashboard collects open tasks, and another lists pages by label.
- **Chat.** A side panel on every page sends questions to Claude Code or Codex
  and shows the answers. On request, it writes or updates pages, then lists
  the pages it changed, with links.
- **Space instructions.** Each space can carry standing instructions (such as
  language, tone or format) that the chat and other AI clients follow when
  they write there.
- **Light and dark themes.**

## Requirements

- macOS or Windows. The installer brings its own copy of Node.js, so nothing
  needs to be installed beforehand, and it doesn't need administrator rights.
- For the chat: Claude Code 2.1.259 or later, or Codex 0.157.0 or later,
  installed and signed in.

## Installation

**macOS**: in Terminal, run:

```bash
curl -fsSL https://github.com/elmir-mamedov/kb/releases/latest/download/install.sh | bash
```

**Windows**: in PowerShell, run:

```powershell
irm https://github.com/elmir-mamedov/kb/releases/latest/download/install.ps1 | iex
```

The installer asks a few yes/no questions; pressing Enter accepts each default.
It installs KB25 into `~/Library/Application Support/KB25` on macOS or
`%LOCALAPPDATA%\KB25` on Windows, and keeps pages in a `KB25` folder in your
home folder. If it finds an existing knowledge base, it offers to use that
instead. It can also connect KB25 to the Claude app and to Claude Code.

After installation, KB25 opens from Spotlight on macOS or the Start menu on
Windows.

## Using KB25

KB25 is an app with a window of its own and its own icon in the Dock or the
taskbar. It runs a small server on your computer, which accepts connections
from this computer only. Closing the window quits KB25, as quitting any app
does, and so does the power button in the top-right corner; links to other
sites open in your default browser. It needs macOS 13 or later, or Windows 10
or 11 with the Microsoft Edge WebView2 Runtime, which comes with Edge; without
WebView2, KB25 opens in your default browser instead and quits with the power
button.

**Writing pages.** Create a space from the spaces page, then add pages and
folders from the sidebar. **Edit** opens a page's Markdown. Saved changes are
committed to the space's git repository, so earlier versions stay available.

**Using the chat.** The sparkles button in the top-right corner opens the
chat. The chat answers questions in the panel. It writes to the knowledge base
only when asked directly, for example "write a page about…", "add this to the
KB", or "write it down" after an answer, or when **Write to KB** is switched
on under the message box. New pages go into the space being viewed, and the
chat lists every page it created or changed when it finishes.

The chat runs the Claude Code or Codex installed on your computer, under the
account it is signed in with, so its use counts against that account's plan.
When both are available, a switch under the message box picks one for each
new chat. Two menus under the message box set the model and effort level for
the next message, from those that Claude Code or Codex offers. The chat starts
on Opus 5.5 for Claude Code and on GPT-6-Sol for Codex (GPT-6-Luna while
GPT-6-Sol isn't available to the account), both at extra high effort, and
keeps your last choice for each program. The model settings in your own
Claude Code or Codex configuration don't apply to the chat. Conversations are stored in the `.kb25/chat` folder of your
knowledge base, separate from the spaces.

**Using KB25 from Claude.** Once connected during installation, the Claude app
and Claude Code can search, read and write your pages through the kb25 MCP
server. Changes made this way are committed like any other edit, and the
sidebar marks the new pages until you open them.

## Updating and removing

When a new version is available, a notice appears in the bottom-right corner
of KB25. **Update** installs it in the background and reloads the page. Pages
and settings are kept.

Running the install command again also updates KB25 when a newer version
exists. When KB25 is already up to date, the command offers to remove it.
Removing KB25 leaves your pages in place.

## Feedback

The speech-bubble button in the top-right corner sends a bug report or
suggestion to the developer, with optional screenshots and an optional email
address for a reply. Each report includes KB25's version, the operating
system, the browser and its window size. The current page, recent errors and
the end of KB25's log are added only if you tick them, and **What else is
sent** shows their contents before sending. Reports written while offline are
sent once a connection is available.

## Development

The application is in [`app/`](app/README.md), and repository guidelines are
in [`AGENTS.md`](AGENTS.md).
