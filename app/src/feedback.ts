import fs from "node:fs";
import path from "node:path";
import { MAX_BODY_BYTES, isObject, readReportBody, type Facts, type SendResult } from "@elmir-mamedov/feedback";
import { createOutbox, describeOs, logTail } from "@elmir-mamedov/feedback/node";

/**
 * Feedback to the developer, through @elmir-mamedov/feedback. The viewer's
 * dialog (views.ts) asks GET /_feedback for what only the server knows
 * (KB25's version, the OS, Node, and the log tail) and shows it before
 * sending. POST /_feedback takes the report the dialog builds, sets those
 * facts as the server knows them, and hands it to the outbox, which sends it
 * to the relay, or keeps it and retries while the relay is out of reach.
 * Nothing leaves without a Send.
 */

/** The relay every app's feedback goes through (github.com/elmir-mamedov/feedback-relay). */
export const DEFAULT_FEEDBACK_RELAY = "https://feedback-relay.elmir-together.workers.dev";

/** KB25's id on the relay. */
export const FEEDBACK_APP = "kb25";

/** What POST /_feedback may carry: one report, as the multipart the relay takes. */
export const FEEDBACK_BODY_LIMIT = MAX_BODY_BYTES;

/** What GET /_feedback answers: everything a report carries besides what the person writes. */
export interface FeedbackInfo {
  version: string;
  facts: Facts;
  /** The log tail a report carries when ticked, or null when this copy keeps no log. */
  logs: string | null;
  /** Reports waiting in the outbox. */
  queued: number;
}

export interface FeedbackOptions {
  /** The relay's URL, without a path. */
  relay: string;
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
  info(): FeedbackInfo;
  /** Read the dialog's multipart body, then send the report or queue it. */
  submit(body: Uint8Array, contentType: string): Promise<SendResult>;
  /** Send what the outbox holds, oldest first; resolves to how many went. */
  flush(): Promise<number>;
  /** Retry the outbox now and then, without keeping the process alive for it. */
  startRetrying(): void;
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

/**
 * Reports KB25 0.3.0 and earlier left in the outbox, in the old relay's
 * format (everything besides the message in one `diagnostics` object),
 * rewritten as the reports the relay takes now, so they're sent rather than
 * dropped as malformed. Each keeps its time, so the oldest still goes first.
 */
export function migrateOutbox(dir: string): number {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return 0;
  }
  let migrated = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const stored: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!isObject(stored) || !isObject(stored.diagnostics)) continue;
      const { diagnostics: d, ...report } = stored;
      const facts = { Install: d.install, OS: d.os, Node: d.node, Browser: d.browser, Page: d.page };
      const { mtime } = fs.statSync(file);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...report, version: d.version, facts, errors: d.errors, logs: d.logs }));
      fs.renameSync(`${file}.tmp`, file);
      fs.utimesSync(file, mtime, mtime);
      migrated++;
    } catch {
      // Unreadable: the outbox drops it on its first flush.
    }
  }
  return migrated;
}

export function makeFeedback(options: FeedbackOptions): Feedback {
  migrateOutbox(options.outboxDir);
  const outbox = createOutbox({ relay: options.relay, app: FEEDBACK_APP, dir: options.outboxDir, fetch: options.fetch });
  const facts = (): Facts => ({ Install: options.install, OS: describeOs(), Node: process.version });

  return {
    info() {
      return {
        version: options.version,
        facts: facts(),
        logs: logTail(options.logFiles, { home: options.home }),
        queued: outbox.size(),
      };
    },

    async submit(body, contentType) {
      const parsed = await readReportBody(body, contentType);
      if (!parsed.ok) return { status: "refused", error: parsed.error };
      // The dialog had these from GET /_feedback; the server's own word counts.
      return outbox.submit({ ...parsed.report, version: options.version, facts: { ...parsed.report.facts, ...facts() } });
    },

    flush: () => outbox.flush(),

    startRetrying() {
      outbox.startRetrying();
    },
  };
}
