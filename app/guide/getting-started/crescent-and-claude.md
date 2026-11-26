---
title: crescent and Claude
id: 3h7al7v5pv7rj
order: 6
summary: Connect crescent to the Claude app and Claude Code, so Claude can read and write your pages, and have answers written as pages with write-up.
---
Besides crescent's own chat, you can work with your pages from the **Claude app** and from **Claude Code**. Once they are connected, Claude can search, read and write your pages there, as if they were part of the conversation.

## What the connection is

The Claude app and Claude Code connect to other programs through **MCP** (Model Context Protocol), a standard way for an AI app to use another program's tools. crescent runs a small MCP server on your computer, and Claude knows it as **crescent**. Connected to it, Claude can:

- search your knowledge base and read its pages
- write new pages and change existing ones
- follow your [[id:3q7e0k3mmkit8#space-instructions|space instructions]]

The connection runs between programs on your computer, but what Claude reads from your pages becomes part of the conversation, and goes to Claude like anything you type to it. Pages Claude writes are saved like any other edit, so [[id:001yas85m3h0y|every version is kept]], and they show a blue dot in the sidebar until you open them.

## Connecting

The installer asks two questions about this: **Connect crescent to the Claude app?** and **Connect crescent to Claude Code?** Press Enter on each to connect.

To connect later, for example after installing the Claude app, run the install command again. On **macOS**, in Terminal:

```bash
curl -fsSL https://github.com/elmir-mamedov/crescent/releases/latest/download/install.sh | bash
```

On **Windows**, in PowerShell:

```powershell
irm https://github.com/elmir-mamedov/crescent/releases/latest/download/install.ps1 | iex
```

When crescent is already up to date, it first asks whether to remove crescent: press Enter to keep it. It then asks the two questions above, for whichever app isn't connected yet.

Then:

- **Claude app**: quit it completely and open it again.
- **Claude Code**: start a new session.

Claude may ask your permission the first time it uses crescent.

## Using it

Ask in your own words, and mention crescent or your knowledge base so Claude knows where to look:

- "What do my notes in crescent say about alkenes?"
- "Add a page on this to my KB, in the Chemistry space."
- "Address the tasks I left on my Organic chemistry pages."

## write-up: answers as pages

To have Claude answer by writing pages instead of in the chat:

- **In the Claude app**: open the **+** menu, then crescent, then **write-up**. Type your question in the box, and Claude writes it up as a page.
- **In Claude Code**: type `/mcp__crescent__write-up`. Every question you ask after it becomes a page.

**write-up-off** (`/mcp__crescent__write-up-off` in Claude Code) goes back to answers in the chat.
