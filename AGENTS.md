# Repository Guidelines

## Project Structure & Module Organization

This repository contains a lean Markdown knowledge-base viewer. Application code lives in `app/src/` and is organized by responsibility: `server.ts` wires Fastify routes and configuration, `content.ts` reads the knowledge-base tree, `frontmatter.ts` parses page metadata, `markdown.ts` renders Markdown, and `views.ts` builds HTML. The chat drawer runs the person's own Claude Code or Codex: `agent-cli.ts` (what the two engines share), `claude-cli.ts` (`claude -p`), `codex-cli.ts` (`codex exec`), `chat.ts` (turns, the system prompt, the report of written pages) and `chat-store.ts` (threads under `<KB_DIR>/.kb25/chat`). Runtime package files are in `app/`.

Knowledge-base content lives in `kb/`. Each top-level folder under `kb/` is a **space** and its own git repo (`kb/<space>/.git`); `kb/` itself is not versioned. Folders are navigation sections, `index.md` files are section landing pages, and leaf pages use lowercase hyphenated filenames such as `kb/engineering/runbooks/deploy.md`. Assets belong under each space's own `kb/<space>/_assets/` and are referenced with the portable relative form `_assets/file.png` (rewritten to `/<space>/_assets/file.png` at render time). Root files such as `first-step.md` and `knowledge-base-plan.md` are planning/spec notes.

Feedback comes from [`@elmir-mamedov/feedback`](https://github.com/elmir-mamedov/feedback), a dependency pinned to a release tag in `app/package.json`: it draws the viewer's feedback dialog (loaded from `/_vendor/feedback/`, mounted by `FEEDBACK_SCRIPT` in `views.ts`), and `app/src/feedback.ts` uses its outbox to send each report to the shared relay (the private `elmir-mamedov/feedback-relay` repo), which files it as an issue in the private `elmir-mamedov/kb25-feedback` repo. The report format and limits live in that package; change them there, release it, and bump the tag here. `relay/` is the old KB25-only Worker, kept running for copies of KB25 0.3.0 and earlier, which post to it; don't build on it, and retire it once those copies have updated (`relay/README.md` covers it).

## Build, Test, and Development Commands

Run commands from `app/`:

- `npm install` installs runtime and TypeScript tooling.
- `npm run dev` starts the viewer with `tsx watch` at `http://localhost:4000`.
- `npm start` runs the server once without watch mode.
- `npm run app:install` installs `~/Applications/KB25.app` (macOS), a Spotlight-launchable app that starts the server if needed and opens KB25's own window (see Installer & Releases).
- `npm run typecheck` runs `tsc --noEmit`; use this as the primary verification step.
- `npm run build:plugin` bundles the MCP server into the kb25 plugin.
- `npm run package:plugin` rebuilds that bundle and zips the plugin into `dist/kb25-<version>.zip`.
- `npm run build:shell` builds KB25's native windows into `shell/build/`, each where its tools are: the macOS one with `swiftc`, the Windows one with the .NET SDK (on any system). `--require mac,windows` fails instead of skipping.
- `npm run build:release` builds `dist/kb25.zip`, what the one-line installer downloads; it builds both windows, so it runs on macOS with the .NET SDK (`DOTNET` names a `dotnet` not on `PATH`).

There is no build step for development; TypeScript runs directly through `tsx`. The one exception is the kb25 plugin: an installed plugin runs `kb25-plugin/server/mcp.mjs`, a single-file bundle of `src/mcp.ts`, because it is copied into the client's plugin cache without this checkout or its `node_modules`. The bundle is a build output and is git-ignored — never commit it. Run `npm run build:plugin` before reinstalling the plugin from this checkout, and `npm run package:plugin` to produce the zip you hand to people; bump the version in `kb25-plugin/.claude-plugin/plugin.json` when you ship a new one.

## Installer & Releases

People who are not developers install KB25 with the one-liners in the root `README.md`. `app/installer/install.sh` (macOS) and `app/installer/install.ps1` (Windows) download a private Node.js and the latest release's `kb25.zip`, then run `app/installer/setup.mjs`, one wizard for both systems, where every question is a `[Y/n]`. An installed copy runs with sign-in off (`AUTH_DISABLED=1`, loopback only) and keeps working without git. It listens on the first free port from 25250 (written to its `.env`), clear of the 4000 that dev servers, this checkout's included, start on. An install or update moves a copy that KB25 0.5.0 or earlier put on 4000–4099 there, and the restarted server answers the old port for five minutes (`KB25_MOVED_FROM`), so the page that started the update finds the new version; drop that move once those copies have updated. Keep the wizard's questions few and Enter-safe; anything a person must type is a bug. `KB25_UPDATE=1` runs the same installer unattended, for updates: no terminal, every question answered no (an update never changes an install-time choice), and the server restarted in the background. Any new question must still make sense answered no.

KB25's window is a native app around the system's web view (`app/shell/`): `mac/KB25.swift` (WKWebView) is `~/Applications/KB25.app` itself, and `windows/Program.cs` (WebView2, .NET Framework 4.8) is `KB25.exe`, which setup copies out of `app/` into `<KB25_HOME>/shell/<version>/`, because Windows locks a running program's files and an update replaces `app/` while the window is open. The window runs the launcher (`app/installer/launcher.mjs`), which starts the server unless one answers and prints its address, and opens that address. Closing the window, or quitting it, sends `POST /_quit?when=idle`; the power button stops the server, which says `quit` on `GET /_window`, and the window closes. An update restarts only the server and ends that stream without `quit`, so the window stays open and listens again. The windows send links that leave KB25, and links asked for in a new window, to the default browser, and allow only http(s) and mailto there. Both are built by `npm run build:shell` and shipped in `kb25.zip`; CI builds each on its own system, and the release smoke test opens the installed one.

To release: bump `version` in `app/package.json`, commit, then tag and push the tag (`git tag v0.3.0 && git push origin v0.3.0`) when asked to push. `.github/workflows/release.yml` builds the zip, installs it for real on macOS and Windows runners, updates it in place with `KB25_UPDATE=1`, smoke-tests it (`app/scripts/smoke-installed.mjs`), and only then publishes the GitHub Release the one-liners download: `kb25.zip`, `install.sh`, `install.ps1`, and `VERSION`, which installed copies read to learn that a newer release is out. `.github/workflows/ci.yml` runs typecheck and tests on Linux, macOS and Windows for every push.

## Coding Style & Naming Conventions

Use TypeScript ES modules, strict types, semicolons, double quotes, and two-space indentation to match the existing code. Keep modules small and focused. Prefer Node standard-library APIs and existing local helpers before adding dependencies.

For content, use lowercase hyphenated Markdown filenames because paths become URLs. Put display titles and optional tags in YAML frontmatter; do not encode human-readable titles in filenames.

## Testing Guidelines

Tests use Node's built-in runner (`node:test`) executed through `tsx`; run them with `npm test` from `app/`. Test files live next to the code they cover as `src/*.test.ts`, and shared setup (throwaway KB dirs, git identity) is in `src/test-helpers.ts`. No extra dependencies are required. Before submitting code, run `npm run typecheck` and `npm test`, and manually smoke-test key routes with `npm run dev`.

## Commit & Pull Request Guidelines

Commit as you work. Every significant change — a feature, a fix, a refactor, a docs or content update — lands as its own commit once `npm run typecheck` and `npm test` pass. Do not leave finished work sitting uncommitted for someone else to stage, and do not roll unrelated changes into one commit. Stage deliberately with explicit paths (`git add app/src/views.ts`), not `git add -A`, so the diff matches the message. If the change belongs on a branch, branch first and then commit. Committing is expected; pushing is not — push only when asked.

Write messages as [Conventional Commits](https://www.conventionalcommits.org): `<type>(<scope>): <description>`. Commits made before this convention was adopted do not follow it; leave them alone and apply it going forward.

- **Type:** one of `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`, `build`, `ci`, `revert`. Pick by what the change does to the product, not by which files it touches — a fix that only edits a test is still `test` if the behaviour did not change.
- **Scope:** optional but preferred, and it names the module or area rather than a path: `server`, `content`, `markdown`, `frontmatter`, `views`, `mcp`, `kb`.
- **Description:** imperative mood, lowercase, no trailing period, and keep the whole subject line under 72 characters. `feat(markdown): add =WxH image size syntax`, not `feat(markdown): Added =WxH image size syntax.`
- **Body:** separated from the subject by a blank line and wrapped at 72 characters. Say why the change was needed and what it does about it; the diff already shows how. Omit the body only when the subject genuinely says everything.
- **Breaking changes:** mark them with `!` before the colon (`feat(mcp)!: rename the token parameter`) and describe the break in a `BREAKING CHANGE:` footer.
- **Trailers:** none otherwise. Never add `Co-Authored-By`, `Generated with`, or any other attribution or tooling footer.

For knowledge-base auto-commits, `kb/README.md` documents the pattern `Update engineering/runbooks/deploy.md via web`.

Pull requests should include a short summary, verification steps, affected paths, and screenshots for UI changes. Link relevant issues or planning docs when applicable.

## Security & Configuration Tips

Configuration is via environment variables: `KB_DIR`, `PORT`, `HOST`, `SITE_TITLE`, the required `AUTH_USERNAME` / `AUTH_PASSWORD` / `AUTH_SESSION_SECRET` (or `AUTH_DISABLED=1` instead, which the server refuses unless `HOST` is loopback), the optional `TRUST_PROXY`, `KB25_CLAUDE_PATH` and `KB25_CODEX_PATH` (the `claude` and `codex` the chat runs, when they are not where the viewer looks), and `KB25_DESKTOP=1`, which the launchers set (KB25.app, the Start-menu shortcut): a server started with no terminal takes `POST /_quit` (KB25's window sends `?when=idle` when it closes, which waits for a running chat turn; without it, it is the power button, which also closes the window through `GET /_window`, the stream the window listens on); it applies only on a loopback `HOST`. The default `HOST=localhost` binds loopback only, so the viewer is reachable from this machine and nowhere else; keep it there. Sign-in is one static credential pair behind a failed-attempt cooldown, so a wider bind publishes a guessable form, in cleartext unless something in front of it terminates TLS. With sign-in off there is no session to protect a request, so the server instead refuses any `Host` that is not loopback (DNS rebinding) and any write whose `Origin` is another site (forged form posts); keep new routes behind that hook. Do not commit secrets from `.env`.
