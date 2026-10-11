import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LIMITS,
  MAX_BODY_BYTES,
  parseReport,
  reportForm,
  type Parsed,
  type Report,
} from "../../relay/src/report.js";

/**
 * Feedback to the developer. The viewer's feedback dialog posts here; this
 * adds what only the server knows (version, OS, Node, and the log tail when
 * the person ticks it) and hands the report to the relay (relay/), which files
 * it as an issue in a private GitHub repo. Nothing leaves without a Send.
 *
 * The report format and its limits are the relay's own (relay/src/report.ts),
 * checked here too, so a report that would be refused is refused before it
 * goes anywhere, and never sits in the outbox. A report the relay can't take
 * right now (offline, rate-limited, GitHub down) waits there and is retried.
 */

export const DEFAULT_FEEDBACK_URL = "https://kb25-feedback.elmir-together.workers.dev/reports";

/** What POST /_feedback may carry: the dialog sends images as base64, a third larger than the bytes. */
export const FEEDBACK_BODY_LIMIT = MAX_BODY_BYTES + Math.ceil(LIMITS.totalImageBytes / 3);

const SEND_TIMEOUT_MS = 60 * 1000;
const FIRST_RETRY_MS = 30 * 1000;
const RETRY_EVERY_MS = 30 * 60 * 1000;
const LOG_LINES = 40;
const LOG_LINE_CHARS = 300;
const LOG_TAIL_BYTES = 16 * 1024;

export type SendResult = { status: "sent" } | { status: "queued" } | { status: "refused"; error: string };

/** What GET /_feedback answers: everything a report would carry besides what the person writes. */
export interface FeedbackPreview {
  version: string;
  install: "installed" | "checkout";
  os: string;
  node: string;
  /** The log tail a report carries when asked, or null when this copy keeps no log. */
  logs: string | null;
  /** Reports waiting in the outbox. */
  queued: number;
  limits: { message: number; images: number; imageBytes: number; totalImageBytes: number };
}

export interface FeedbackOptions {
  endpoint: string;
  outboxDir: string;
  version: string;
  install: "installed" | "checkout";
  /** Logs whose tails a report may carry. Missing ones are skipped. */
  logFiles: string[];
  fetch?: typeof fetch;
  /** The home folder, shown as ~ in the log tail. */
  home?: string;
}

export interface Feedback {
  preview(): Promise<FeedbackPreview>;
  /** Check the dialog's untrusted body, then send it or queue it. */
  submit(body: unknown): Promise<SendResult>;
  /** Send what the outbox holds, oldest first; resolves to how many went. */
  flush(): Promise<number>;
  /** Retry the outbox now and then, without keeping the process alive for it. */
  startRetrying(): void;
}

/** "macOS (Darwin 25.6.0, arm64)": the name a person knows, and the version that pins it down. */
export function describeOs(
  platform: NodeJS.Platform = process.platform,
  release = os.release(),
  arch: string = process.arch
): string {
  const names: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", win32: "Windows", linux: "Linux" };
  return `${names[platform] ?? platform} (${platform === "darwin" ? "Darwin " : ""}${release}, ${arch})`;
}

/** A checkout's version, from the package.json beside src/; an install has VERSION instead. */
export function checkoutVersion(serverDir: string): string {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(serverDir, "..", "package.json"), "utf8"));
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

/** The last bytes of a file, from the first whole line in them. */
function readTail(file: string, bytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The last lines of each log, under its name, with the home folder shown as ~
 * so the report doesn't carry the account name. Null when no log has any.
 */
export function logTail(files: string[], home = os.homedir()): string | null {
  const parts: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readTail(file, LOG_TAIL_BYTES);
    } catch {
      continue;
    }
    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-LOG_LINES)
      .map((line) => (line.length > LOG_LINE_CHARS ? `${line.slice(0, LOG_LINE_CHARS)}…` : line));
    if (lines.length) parts.push(`== ${path.basename(file)} ==\n${lines.join("\n")}`);
  }
  if (!parts.length) return null;
  const joined = home ? parts.join("\n\n").split(home).join("~") : parts.join("\n\n");
  return joined.length > LIMITS.logs ? joined.slice(-LIMITS.logs) : joined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Images as JSON carries them (the dialog's body, an outbox file), base64,
 * turned into the bytes a report holds. Anything else passes through for
 * parseReport to refuse in its own words.
 */
function decodeImages(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((img) =>
    isObject(img) && typeof img.data === "string" ? { type: img.type, data: Buffer.from(img.data, "base64") } : img
  );
}

export function makeFeedback(options: FeedbackOptions): Feedback {
  const { endpoint, outboxDir } = options;
  const fetchImpl = options.fetch ?? fetch;
  const home = options.home ?? os.homedir();
  let flushing: Promise<number> | null = null;

  function facts() {
    return { version: options.version, install: options.install, os: describeOs(), node: process.version };
  }

  /** The report this body asks for, with a fresh id, or why it can't be one. */
  function build(body: unknown): Parsed {
    const input = isObject(body) ? body : {};
    return parseReport({
      id: crypto.randomUUID(),
      kind: input.kind,
      message: input.message,
      email: input.email,
      images: decodeImages(input.images),
      diagnostics: {
        ...facts(),
        browser: input.browser,
        page: input.page,
        errors: input.errors,
        logs: input.includeLogs === true ? logTail(options.logFiles, home) ?? undefined : undefined,
      },
    });
  }

  /** "retry" for anything that might go through later; a refusal is final. */
  async function deliver(report: Report): Promise<"sent" | "retry" | { refused: string }> {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        body: reportForm(report),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      return "retry";
    }
    if (response.ok) return "sent";
    if (response.status === 429 || response.status >= 500) return "retry";
    const answer: unknown = await response.json().catch(() => null);
    const error = isObject(answer) && typeof answer.error === "string" ? answer.error : "";
    return { refused: error || `The feedback service refused the report (${response.status}).` };
  }

  function outboxFiles(): string[] {
    try {
      return fs
        .readdirSync(outboxDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(outboxDir, name));
    } catch {
      return [];
    }
  }

  function queue(report: Report): void {
    fs.mkdirSync(outboxDir, { recursive: true });
    const file = path.join(outboxDir, `${report.id}.json`);
    const images = report.images.map((img) => ({ type: img.type, data: Buffer.from(img.data).toString("base64") }));
    // Written aside and renamed in, so a flush never reads half a report.
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...report, images }));
    fs.renameSync(`${file}.tmp`, file);
  }

  async function flushOnce(): Promise<number> {
    const files = outboxFiles()
      .map((file) => ({ file, mtime: fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0 }))
      .sort((a, b) => a.mtime - b.mtime);
    let sent = 0;
    for (const { file } of files) {
      let parsed: Parsed;
      try {
        const stored: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        parsed = parseReport(isObject(stored) ? { ...stored, images: decodeImages(stored.images) } : stored);
      } catch {
        parsed = { ok: false, error: "unreadable" };
      }
      if (!parsed.ok) {
        console.warn(`Dropping a queued feedback report the relay would refuse: ${parsed.error}`);
        fs.rmSync(file, { force: true });
        continue;
      }
      const outcome = await deliver(parsed.report);
      if (outcome === "retry") break; // still unreachable; the rest wait too
      if (outcome !== "sent") console.warn(`The relay refused a queued feedback report: ${outcome.refused}`);
      fs.rmSync(file, { force: true });
      if (outcome === "sent") sent++;
    }
    return sent;
  }

  function flush(): Promise<number> {
    flushing ??= flushOnce().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  return {
    async preview() {
      return {
        ...facts(),
        logs: logTail(options.logFiles, home),
        queued: outboxFiles().length,
        limits: {
          message: LIMITS.message,
          images: LIMITS.images,
          imageBytes: LIMITS.imageBytes,
          totalImageBytes: LIMITS.totalImageBytes,
        },
      };
    },

    async submit(body) {
      const built = build(body);
      if (!built.ok) return { status: "refused", error: built.error };
      const outcome = await deliver(built.report);
      if (outcome === "sent") {
        // The relay is reachable again: a good moment for anything queued.
        if (outboxFiles().length) void flush().catch(() => {});
        return { status: "sent" };
      }
      if (outcome === "retry") {
        queue(built.report);
        return { status: "queued" };
      }
      return { status: "refused", error: outcome.refused };
    },

    flush,

    startRetrying() {
      const tick = () => void flush().catch(() => {});
      setTimeout(tick, FIRST_RETRY_MS).unref();
      setInterval(tick, RETRY_EVERY_MS).unref();
    },
  };
}
