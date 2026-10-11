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
folder. If you already have a knowledge base from the kb25 plugin, the
installer offers to use it where it is instead.

If you use the Claude app or Claude Code, the installer offers to connect KB25
to it, so Claude can find, read and write your pages.

## Send feedback

Found a bug, or have an idea? Click the speech bubble in the top-right corner
of the viewer. Write what happened, add screenshots if they help (paste them,
drop them in, or capture the tab), and press **Send**. Leave your email if
you'd like a reply.

A report goes to the developer of KB25 and nobody else. Along with what you
write, it carries KB25's version, your operating system and your browser.
The page you were on, recent errors and the end of KB25's log go only if you
tick them, and **What else is sent** shows exactly what that is before you
send. If you're offline, KB25 keeps the report and sends it later.

## Update or remove

When a new version is out, KB25 says so in the bottom-right corner of the
viewer: click **Update** and it installs in the background, then the page
reloads on the new version. Your pages and settings stay as they are.

You can also run the same line again. It updates KB25 when there's a new
version; when there isn't, it offers to remove KB25. Removing keeps your pages.

## For developers

The app lives in [`app/`](app/README.md); repository guidelines are in
[`AGENTS.md`](AGENTS.md).
