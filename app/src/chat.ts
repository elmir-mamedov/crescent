/**
 * The viewer's chat: one conversation per thread, each turn a `claude -p` run
 * (claude-cli.ts) with the kb25 MCP server attached.
 *
 * A turn belongs to the server, not to the page that started it: every click in
 * the viewer is a full page load, so the drawer that sent a message is gone by
 * the time the answer arrives. A run buffers what it has said, and a page that
 * loads mid-run replays the buffer and follows the rest live.
 *
 * When a turn has written to the KB, the server — not the model — tells the
 * person which pages changed: it reads the kb25 tool calls the turn made and
 * appends a report of them, with links. The model is told the app does this,
 * so its own text after a write is only ever a caveat.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PageNode } from "./content.js";
import {
  mcpConfig,
  startTurn as realStartTurn,
  type ClaudeEvent,
  type ClaudeStatus,
  type TurnFiles,
  type TurnOptions,
} from "./claude-cli.js";
import {
  isThreadId,
  threadTitle,
  type ChatMessage,
  type ChatStore,
  type ChatThread,
  type PageChange,
  type ThreadSummary,
} from "./chat-store.js";

/**
 * Appended to Claude Code's own system prompt for every chat thread. Claude
 * records it on a thread's first turn and reuses it after, so a change here
 * reaches new threads only.
 */
export const CHAT_PROMPT = `# KB25 chat

You are the assistant in the chat drawer of KB25, a personal knowledge base of Markdown pages. The person is talking to you from inside the app while they read it. The kb25 tools give you read and write access to the knowledge base, and web search and fetch let you check facts. You have no other tools: no shell and no local files. Reply in the language the person writes in.

Each message starts with a <kb25-context> block, written by the app rather than the person, saying which page they are viewing and whether they switched on "Write to KB".

## Chat or pages

Answer in the chat by default, at whatever depth the question needs. A request to explain something, even "from the ground up", is a chat request. When the question is about what the knowledge base says, look it up and name the pages you drew on.

Write to the knowledge base only when the person asks for it in so many words ("write a page on…", "add this to the KB", "write it down", "document…", "save that", "update this page", "fix the intro here"), or when the context says Write to KB is on. With Write to KB on, treat the message as a request for pages even when it is phrased as a question.

"Write it down" after a chat answer means: make the topic a proper reference page for someone who lands on it cold. The conversation is the starting point, not the text to copy, so the page is usually fuller and better organised than the chat answer was.

Delete pages, create or delete spaces, and move or rename things only when the current message asks for exactly that.

## Writing pages

- Put new pages in the space the person is viewing unless they name another. Look at that space first (kb_list_pages, kb_search) and file the page beside similar ones rather than inventing new structure. A big topic can deserve a folder of several pages.
- A new page is one kb_create_page call with the full body. To change a page, read it with kb_get_page (format: raw) first, then send the complete replacement with kb_update_page, keeping its frontmatter and id.
- Write for a reader arriving cold, not as a reply to this conversation: lead with what they need first, use clear headings, and link related pages by id ([[id:<id>]]).
- When a page rests on facts you looked up on the web, cite the sources on the page.
- A space's instructions arrive with the tool results; follow them over these defaults.

## After writing

As soon as you finish, the app shows the person every page you created or changed, with links. So once you have written pages, do not summarise them, list them, link them or announce that you wrote them. End with no text at all, unless the person needs to know something the pages do not show (an assumption you made, why you filed something where you did, a part you could not verify or left out). Then say it in one or two sentences.

If the message also asked something the pages do not answer, answer just that part, briefly.
`;

/** What a page shows while a turn runs, and what it is told when it attaches. */
export type RunEvent =
  /** The person's message, as stored; another tab learns of the turn from it. */
  | { type: "user"; message: ChatMessage }
  /** A piece of the reply, streamed. Pieces of separate blocks arrive with a blank line between. */
  | { type: "text"; text: string }
  /** What the turn is doing right now: "Reading demo/intro…". */
  | { type: "activity"; text: string }
  /** A finished message — the reply, the report, an error — as stored. */
  | { type: "message"; message: ChatMessage }
  | { type: "done" };

export type SendOutcome =
  | { ok: true; thread: ChatThread }
  | { ok: false; status: 400 | 409 | 503; error: string; claude?: ClaudeStatus };

export interface ChatDeps {
  store: ChatStore;
  /** Claude Code's state; `fresh` skips any cache. */
  claude: (fresh?: boolean) => Promise<ClaudeStatus>;
  /** How to start the kb25 MCP server for a turn. */
  mcp: { command: string; args: string[]; env: Record<string, string> };
  /** Every page, live and archived, flattened: for the context line and the report. */
  pages: () => Promise<PageNode[]>;
  startTurn?: (options: TurnOptions) => ReturnType<typeof realStartTurn>;
  now?: () => Date;
}

export interface ChatThreadSummary extends ThreadSummary {
  running: boolean;
}

export interface Chat {
  status(fresh?: boolean): Promise<ClaudeStatus>;
  list(): Promise<ChatThreadSummary[]>;
  thread(id: string): Promise<ChatThread | null>;
  /** Start a turn; the thread is created by its first message. */
  send(id: string, input: { text: string; forcePages: boolean; slug?: string }): Promise<SendOutcome>;
  running(id: string): boolean;
  /**
   * Follow a thread's running turn: the events so far, then the rest live.
   * Null when nothing is running. Call the returned function to stop following.
   */
  subscribe(id: string, listener: (event: RunEvent) => void): (() => void) | null;
  /** False when nothing was running. */
  stop(id: string): boolean;
  /** Delete a thread that is not running. */
  remove(id: string): Promise<boolean>;
  activeCount(): number;
  /** Called each time the last running turn finishes. */
  onIdle(listener: () => void): void;
  /** Stop every turn and wait for them to wind down (a quitting server). */
  stopAll(): Promise<void>;
}

/** Long enough for a pasted article, short of a runaway paste. */
export const MAX_MESSAGE_LENGTH = 50_000;

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: { isError: boolean; text: string };
}

interface Run {
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  stop: () => void;
  stopped: boolean;
  finished: Promise<void>;
}

export function makeChat(deps: ChatDeps): Chat {
  const runs = new Map<string, Run>();
  const idleListeners: (() => void)[] = [];
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  const startTurn = deps.startTurn ?? realStartTurn;

  async function turnFiles(): Promise<TurnFiles> {
    const dir = deps.store.dir;
    await fs.mkdir(path.join(dir, "cwd"), { recursive: true });
    const files = { mcpConfig: path.join(dir, "mcp.json"), systemPrompt: path.join(dir, "prompt.md") };
    await fs.writeFile(files.mcpConfig, mcpConfig(deps.mcp.command, deps.mcp.args, deps.mcp.env));
    await fs.writeFile(files.systemPrompt, CHAT_PROMPT);
    return files;
  }

  function emit(run: Run, event: RunEvent): void {
    run.events.push(event);
    for (const listener of run.listeners) listener(event);
  }

  async function send(id: string, input: { text: string; forcePages: boolean; slug?: string }): Promise<SendOutcome> {
    if (!isThreadId(id)) return { ok: false, status: 400, error: "Not a thread id." };
    const text = input.text.trim();
    if (!text) return { ok: false, status: 400, error: "The message is empty." };
    if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, status: 400, error: "The message is too long." };
    if (runs.has(id)) return { ok: false, status: 409, error: "This chat is still answering." };
    const claude = await deps.claude();
    if (claude.state !== "ok") return { ok: false, status: 503, error: "Claude Code is not ready.", claude };
    // Checked again: the status check above can take a moment.
    if (runs.has(id)) return { ok: false, status: 409, error: "This chat is still answering." };

    const at = now();
    const thread: ChatThread = (await deps.store.get(id)) ?? {
      id,
      title: threadTitle(text),
      createdAt: at,
      updatedAt: at,
      started: false,
      messages: [],
    };
    const userMessage: ChatMessage = {
      role: "user",
      text,
      at,
      forcePages: input.forcePages,
      ...(input.slug && { slug: input.slug }),
    };
    thread.messages.push(userMessage);
    thread.updatedAt = at;

    let settle!: () => void;
    const run: Run = {
      events: [],
      listeners: new Set(),
      stop: () => {},
      stopped: false,
      finished: new Promise((resolve) => (settle = resolve)),
    };
    runs.set(id, run);
    emit(run, { type: "user", message: userMessage });

    // Saves of one thread run in order, so a late one never overwrites a newer.
    let saving: Promise<unknown> = Promise.resolve();
    const save = () => (saving = saving.then(() => deps.store.save(thread)).catch(() => {}));
    save();

    void (async () => {
      try {
        const pages = await deps.pages();
        const files = await turnFiles();
        const prompt = `${contextBlock(input.slug, input.forcePages, pages)}\n\n${text}`;
        const outcome = await runTurn(thread, run, claude.path, files, prompt, () => {
          if (!thread.started) {
            thread.started = true;
            save();
          }
        });
        for (const message of finishMessages(outcome, run.stopped, pages, now())) {
          thread.messages.push(message);
          emit(run, { type: "message", message });
        }
      } catch (err) {
        const message: ChatMessage = { role: "error", text: errorText(err), at: now() };
        thread.messages.push(message);
        emit(run, { type: "message", message });
      } finally {
        thread.updatedAt = now();
        save();
        await saving;
        emit(run, { type: "done" });
        runs.delete(id);
        settle();
        if (runs.size === 0) for (const listener of idleListeners) listener();
      }
    })();

    return { ok: true, thread };
  }

  /**
   * Run one turn to the end. A thread whose Claude session has gone (its
   * transcript cleared) is started afresh under the same id, once, rather
   * than left unable to continue.
   */
  async function runTurn(
    thread: ChatThread,
    run: Run,
    claudePath: string,
    files: TurnFiles,
    prompt: string,
    onStarted: () => void
  ): Promise<TurnOutcome> {
    const attempt = async (resume: boolean): Promise<TurnOutcome> => {
      const outcome: TurnOutcome = { texts: [], streamed: "", calls: [], code: null, stderr: "" };
      const byId = new Map<string, ToolCall>();
      let breakBefore = false;
      const turn = startTurn({
        claudePath,
        sessionId: thread.id,
        resume,
        files,
        cwd: path.join(deps.store.dir, "cwd"),
        text: prompt,
        onEvent: (event: ClaudeEvent) => {
          switch (event.type) {
            case "init":
              onStarted();
              break;
            case "text": {
              const text = (breakBefore ? "\n\n" : "") + event.text;
              outcome.streamed += text;
              emit(run, { type: "text", text });
              breakBefore = false;
              break;
            }
            case "assistant":
              for (const block of event.blocks) {
                if (block.type === "text") {
                  if (block.text.trim()) outcome.texts.push(block.text);
                  breakBefore = true;
                } else {
                  const call: ToolCall = { name: block.name, input: block.input };
                  byId.set(block.id, call);
                  outcome.calls.push(call);
                  emit(run, { type: "activity", text: activityText(block.name, block.input) });
                }
              }
              break;
            case "tool_result": {
              const call = byId.get(event.toolUseId);
              if (call) call.result = { isError: event.isError, text: event.text };
              break;
            }
            case "retry":
              emit(run, {
                type: "activity",
                text: `Claude is busy; trying again (${event.attempt} of ${event.maxRetries})…`,
              });
              break;
            case "result":
              outcome.result = event;
              break;
          }
        },
      });
      run.stop = () => turn.stop();
      if (run.stopped) turn.stop();
      const { code, stderr } = await turn.done;
      outcome.code = code;
      outcome.stderr = stderr;
      return outcome;
    };

    const first = await attempt(thread.started);
    const lost = thread.started && !first.result && !run.stopped && /no conversation found/i.test(first.stderr);
    return lost ? attempt(false) : first;
  }

  return {
    status: (fresh) => deps.claude(fresh),
    async list() {
      return (await deps.store.list()).map((summary) => ({ ...summary, running: runs.has(summary.id) }));
    },
    thread: (id) => deps.store.get(id),
    send,
    running: (id) => runs.has(id),
    subscribe(id, listener) {
      const run = runs.get(id);
      if (!run) return null;
      for (const event of run.events) listener(event);
      run.listeners.add(listener);
      return () => run.listeners.delete(listener);
    },
    stop(id) {
      const run = runs.get(id);
      if (!run) return false;
      run.stopped = true;
      run.stop();
      return true;
    },
    async remove(id) {
      if (runs.has(id)) return false;
      return deps.store.remove(id);
    },
    activeCount: () => runs.size,
    onIdle(listener) {
      idleListeners.push(listener);
    },
    async stopAll() {
      const running = [...runs.values()];
      for (const run of running) {
        run.stopped = true;
        run.stop();
      }
      await Promise.all(running.map((run) => run.finished));
    },
  };
}

interface TurnOutcome {
  /** The reply's text blocks, each complete. */
  texts: string[];
  /** Everything streamed, the unfinished last block included. */
  streamed: string;
  calls: ToolCall[];
  result?: Extract<ClaudeEvent, { type: "result" }>;
  code: number | null;
  stderr: string;
}

/**
 * The messages a finished turn leaves: the report of what it wrote, then its
 * reply (after a write, the caveat that goes with the report), then any failure.
 */
function finishMessages(outcome: TurnOutcome, stopped: boolean, pages: PageNode[], at: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const changes = resolveChanges(pageChanges(outcome.calls), pages);
  if (changes.length > 0) messages.push({ role: "report", changes, at });
  // A stopped turn keeps what it had said, though its last block never finished.
  const reply = (stopped ? outcome.streamed : outcome.texts.join("\n\n")).trim();
  if (reply) messages.push({ role: "assistant", text: reply, at });
  if (stopped) {
    messages.push({ role: "error", text: "Stopped.", at });
  } else if (!outcome.result) {
    const detail = outcome.stderr.split("\n").filter(Boolean).slice(-3).join("\n");
    messages.push({
      role: "error",
      text: detail || `Claude Code stopped unexpectedly${outcome.code === null ? "" : ` (exit code ${outcome.code})`}.`,
      at,
    });
  } else if (outcome.result.isError) {
    messages.push({ role: "error", text: outcome.result.text || `Claude Code reported ${outcome.result.subtype}.`, at });
  }
  return messages;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The context line a turn's message opens with: what the person is looking at,
 * and whether they asked for pages with the toggle. Sent with every message
 * rather than in the system prompt, which Claude fixes on the first turn.
 */
export function contextBlock(slug: string | undefined, forcePages: boolean, pages: PageNode[]): string {
  const lines: string[] = [];
  const node = slug ? pages.find((page) => page.slug === slug) : undefined;
  if (node) {
    const space = node.slug.split("/")[0];
    const id = node.id ? `, id ${node.id}` : "";
    lines.push(
      node.slug === space
        ? `The person is viewing the home page of space "${space}" ("${node.title}"${id}).`
        : `The person is viewing the ${node.isFolder ? "folder" : "page"} "${node.title}" (slug ${node.slug}${id}) in space "${space}".`
    );
  } else if (slug) {
    lines.push(`The person is viewing ${slug}, in space "${slug.split("/")[0]}".`);
  } else {
    lines.push("The person is not viewing any page or space right now.");
  }
  if (forcePages) {
    lines.push('"Write to KB" is on: put the answer into the knowledge base as pages, not into the chat.');
  }
  return `<kb25-context>\n${lines.join("\n")}\n</kb25-context>`;
}

const KB = "mcp__kb25__";

/** What a turn is doing, from the tool it just called. */
export function activityText(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  const quoted = (value: string) => `“${value.length > 60 ? `${value.slice(0, 59)}…` : value}”`;
  switch (name) {
    case "WebSearch":
      return str("query") ? `Searching the web for ${quoted(str("query"))}…` : "Searching the web…";
    case "WebFetch": {
      try {
        return `Reading ${new URL(str("url")).hostname}…`;
      } catch {
        return "Reading a web page…";
      }
    }
    case `${KB}kb_search`:
      return str("query") ? `Searching the KB for ${quoted(str("query"))}…` : "Searching the KB…";
    case `${KB}kb_list_spaces`:
    case `${KB}kb_list_pages`:
    case `${KB}kb_list_notes`:
      return "Looking through the KB…";
    case `${KB}kb_get_space_instructions`:
      return "Reading the space's instructions…";
    case `${KB}kb_get_page`:
      return `Reading ${str("slug") || "the home page"}…`;
    case `${KB}kb_create_page`:
      return `Writing ${quoted(str("title"))}…`;
    case `${KB}kb_create_folder`:
      return `Creating the folder ${quoted(str("title"))}…`;
    case `${KB}kb_create_space`:
      return `Creating the space ${quoted(str("title"))}…`;
    case `${KB}kb_update_page`:
      return `Updating ${str("slug")}…`;
    case `${KB}kb_add_agent_note`:
    case `${KB}kb_resolve_agent_note`:
      return `Annotating ${str("slug")}…`;
    case `${KB}kb_move_page`:
    case `${KB}kb_rename_page`:
    case `${KB}kb_rename_folder`:
      return `Moving ${str("slug") || str("sourceSlug")}…`;
    case `${KB}kb_archive_page`:
      return `Archiving ${str("slug")}…`;
    case `${KB}kb_restore_page`:
      return `Restoring ${str("slug")}…`;
    case `${KB}kb_delete_page`:
      return `Deleting ${str("slug")}…`;
    default:
      return "Working…";
  }
}

/**
 * The pages a turn changed, from its successful kb25 write calls, one entry
 * per page in the order first touched. A page created and then edited counts
 * as created; one created and then deleted is not reported at all; a move
 * carries the entry (and anything filed under it) to the new slug.
 */
export function pageChanges(calls: { name: string; input: Record<string, unknown>; result?: { isError: boolean; text: string } }[]): PageChange[] {
  const changes: PageChange[] = [];
  const at = (slug: string) => changes.find((change) => change.slug === slug);
  const touch = (change: PageChange) => {
    const existing = at(change.slug);
    if (!existing) return void changes.push(change);
    // An earlier entry for the same page: creation, and a deletion, outrank an edit.
    if (existing.kind === "created" && change.kind !== "deleted") return;
    Object.assign(existing, { kind: change.kind, ...(change.id && { id: change.id }) });
  };

  for (const call of calls) {
    if (!call.name.startsWith(KB) || !call.result || call.result.isError) continue;
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(call.result.text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const str = (source: Record<string, unknown>, key: string) => (typeof source[key] === "string" ? (source[key] as string) : "");
    const slug = str(result, "slug");
    const id = str(result, "id") || undefined;
    const title = str(call.input, "title");
    switch (call.name.slice(KB.length)) {
      case "kb_create_page":
        if (result.created === true && slug) changes.push({ kind: "created", what: "page", id, slug, title });
        break;
      case "kb_create_folder":
        if (result.created === true && slug) changes.push({ kind: "created", what: "folder", id, slug, title });
        break;
      case "kb_create_space":
        if (result.created === true && slug) changes.push({ kind: "created", what: "space", id, slug, title });
        break;
      case "kb_update_page":
        if (result.updated === true && slug) touch({ kind: "updated", what: "page", slug, title: "" });
        break;
      case "kb_add_agent_note":
        if (result.added === true && slug) touch({ kind: "noted", what: "page", slug, title: "" });
        break;
      case "kb_rename_folder":
        if (result.renamed === true && slug) touch({ kind: "renamed", what: "folder", slug, title: str(call.input, "name") });
        break;
      case "kb_archive_page":
        if (result.archived === true && slug) touch({ kind: "archived", what: "page", slug, title: "" });
        break;
      case "kb_restore_page":
        if (result.restored === true && slug) touch({ kind: "restored", what: "page", slug, title: "" });
        break;
      case "kb_delete_page": {
        if (result.deleted !== true || !slug) break;
        const existing = at(slug);
        if (existing?.kind === "created") {
          changes.splice(changes.indexOf(existing), 1);
        } else {
          touch({ kind: "deleted", what: "page", slug, title: existing?.title ?? "" });
        }
        // Whatever was filed under a deleted section went with it.
        for (let i = changes.length - 1; i >= 0; i--) {
          if (changes[i].slug.startsWith(`${slug}/`)) changes.splice(i, 1);
        }
        break;
      }
      case "kb_move_page":
      case "kb_rename_page": {
        const oldSlug = str(result, "oldSlug");
        const newSlug = str(result, "newSlug");
        if ((result.moved !== true && result.renamed !== true) || !oldSlug || !newSlug) break;
        for (const change of changes) {
          if (change.slug === oldSlug) change.slug = newSlug;
          else if (change.slug.startsWith(`${oldSlug}/`)) change.slug = newSlug + change.slug.slice(oldSlug.length);
        }
        const kind = call.name.endsWith("kb_move_page") ? "moved" : "renamed";
        if (!at(newSlug)) changes.push({ kind, what: "page", slug: newSlug, title: "" });
        else touch({ kind, what: "page", slug: newSlug, title: "" });
        break;
      }
    }
  }
  return changes;
}

/**
 * Fill in each change's current slug, title and id from the KB as it stands:
 * by id when the change has one (so it follows a later move), else by slug. A
 * deleted page keeps what it had; one that has since vanished keeps its last
 * known slug, with the slug's last segment for a title if it had none.
 */
export function resolveChanges(changes: PageChange[], pages: PageNode[]): PageChange[] {
  const byId = new Map<string, PageNode>();
  const bySlug = new Map<string, PageNode>();
  for (const page of pages) {
    if (page.id && !byId.has(page.id)) byId.set(page.id, page);
    bySlug.set(page.slug, page);
  }
  return changes.map((change) => {
    const node =
      change.kind === "deleted" ? undefined : (change.id ? byId.get(change.id) : undefined) ?? bySlug.get(change.slug);
    if (!node) return { ...change, title: change.title || change.slug.split("/").pop() || change.slug };
    return { ...change, slug: node.slug, title: node.title, ...(node.id && { id: node.id }) };
  });
}
