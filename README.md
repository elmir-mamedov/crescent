# KB25

A personal knowledge base: Markdown pages you browse and edit in your web
browser, and that Claude can read and write for you.

## Install

Paste one line into a terminal and press Enter at each question.

**Mac**: open the Terminal app and paste:

```bash
curl -fsSL https://github.com/elmir-mamedov/kb/releases/latest/download/install.sh | bash
```

**Windows**: open PowerShell (Start menu, type "PowerShell") and paste:

```powershell
irm https://github.com/elmir-mamedov/kb/releases/latest/download/install.ps1 | iex
```

That's all. No admin password, and nothing else to install first. Afterwards,
open **KB25** like any other app: Spotlight on a Mac (Cmd+Space, type "KB25"),
the Start menu on Windows. Your pages are kept in a `KB25` folder in your home
folder.

If you use the Claude app or Claude Code, the installer offers to connect KB25
to it, so Claude can find, read and write your pages.

## Update or remove

Run the same line again. It updates KB25 when there's a new version; when
there isn't, it offers to remove KB25. Removing keeps your pages.

## For developers

The app lives in [`app/`](app/README.md); repository guidelines are in
[`AGENTS.md`](AGENTS.md).
