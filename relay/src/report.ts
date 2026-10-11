/**
 * A feedback report as a KB25 copy sends it, checked field by field, and the
 * GitHub issue it becomes. Nothing here touches the network or the Workers
 * runtime, so the tests run it under plain Node.
 *
 * The app checks the same limits before it sends (app/src/feedback.ts); these
 * are the ones that count, because anyone can post here.
 */

export const KINDS = ["bug", "idea", "question"] as const;
export type Kind = (typeof KINDS)[number];

/** Image types a report may carry, and the extension each is stored under. */
export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
export type ImageType = keyof typeof IMAGE_TYPES;

export const LIMITS = {
  message: 10_000,
  email: 254,
  images: 5,
  imageBytes: 2 * 1024 * 1024,
  totalImageBytes: 6 * 1024 * 1024,
  /** Version, OS, Node, browser and page: one line each. */
  line: 500,
  errors: 10,
  error: 1_000,
  logs: 20_000,
} as const;

/** The largest request body a valid report can make, with room for the JSON around it. */
export const MAX_BODY_BYTES =
  Math.ceil((LIMITS.totalImageBytes * 4) / 3) + 4 * LIMITS.message + LIMITS.logs + 64 * 1024;

export interface ReportImage {
  type: ImageType;
  /** Base64, no data: prefix. */
  data: string;
}

export interface Diagnostics {
  version: string;
  install: "installed" | "checkout";
  os: string;
  node: string;
  browser?: string;
  page?: string;
  errors?: string[];
  logs?: string;
}

export interface Report {
  /** Chosen by the sending copy, so a retried report lands on the same image paths. */
  id: string;
  kind: Kind;
  message: string;
  email?: string;
  images: ReportImage[];
  diagnostics: Diagnostics;
}

export type Parsed = { ok: true; report: Report } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") fail(`${name} must be text.`);
  if (value.length > max) fail(`${name} is longer than ${max} characters.`);
  return value;
}

function optionalText(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, name, max);
}

/** Bytes a base64 string decodes to. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function image(value: unknown, index: number): ReportImage {
  const name = `Image ${index + 1}`;
  if (!isObject(value)) fail(`${name} is malformed.`);
  if (typeof value.type !== "string" || !Object.hasOwn(IMAGE_TYPES, value.type)) {
    fail(`${name} must be a PNG, JPEG, WebP or GIF.`);
  }
  if (typeof value.data !== "string" || !value.data || value.data.length % 4 || !BASE64.test(value.data)) {
    fail(`${name} is not base64.`);
  }
  if (base64Bytes(value.data) > LIMITS.imageBytes) fail(`${name} is larger than 2 MB.`);
  return { type: value.type as ImageType, data: value.data };
}

function diagnostics(value: unknown): Diagnostics {
  if (!isObject(value)) fail("Diagnostics are missing.");
  if (value.install !== "installed" && value.install !== "checkout") fail("Diagnostics are malformed.");
  let errors: string[] | undefined;
  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors) || value.errors.length > LIMITS.errors) fail("Too many browser errors.");
    errors = value.errors.map((entry) => text(entry, "A browser error", LIMITS.error));
    if (!errors.length) errors = undefined;
  }
  return {
    version: text(value.version, "The version", LIMITS.line),
    install: value.install,
    os: text(value.os, "The OS", LIMITS.line),
    node: text(value.node, "The Node version", LIMITS.line),
    browser: optionalText(value.browser, "The browser", LIMITS.line),
    page: optionalText(value.page, "The page", LIMITS.line),
    errors,
    logs: optionalText(value.logs, "The log", LIMITS.logs),
  };
}

/** Check an untrusted request body; a refusal says what to fix, for the sender to show. */
export function parseReport(body: unknown): Parsed {
  try {
    if (!isObject(body)) fail("The report is malformed.");
    if (typeof body.id !== "string" || !UUID.test(body.id)) fail("The report id is malformed.");
    if (typeof body.kind !== "string" || !(KINDS as readonly string[]).includes(body.kind)) {
      fail("The kind must be bug, idea or question.");
    }
    const message = text(body.message, "The message", LIMITS.message);
    if (!message.trim()) fail("The message is empty.");
    const email = optionalText(body.email, "The email address", LIMITS.email)?.trim();
    if (email && !EMAIL.test(email)) fail("The email address doesn't look right.");
    const rawImages = body.images ?? [];
    if (!Array.isArray(rawImages)) fail("Images are malformed.");
    if (rawImages.length > LIMITS.images) fail(`A report carries at most ${LIMITS.images} images.`);
    const images = rawImages.map(image);
    const total = images.reduce((sum, img) => sum + base64Bytes(img.data), 0);
    if (total > LIMITS.totalImageBytes) fail("The images add up to more than 6 MB.");
    return {
      ok: true,
      report: {
        id: body.id,
        kind: body.kind as Kind,
        message,
        email: email || undefined,
        images,
        diagnostics: diagnostics(body.diagnostics),
      },
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

/** Where a report's image is committed in the feedback repo. */
export function imagePath(report: Report, index: number): string {
  return `reports/${report.id}/${index + 1}.${IMAGE_TYPES[report.images[index].type]}`;
}

/**
 * An @-mention in a report would have GitHub notify that user from the
 * repo owner's account, so anyone could ping anyone through this relay. A
 * zero-width space after the @ keeps the text and drops the mention.
 */
export function defuseMentions(value: string): string {
  return value.replace(/@(?=[A-Za-z0-9])/g, "@​");
}

/** A fenced block that the text inside cannot close early. */
export function fenced(value: string, info = "text"): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${value.replace(/\s+$/, "")}\n${fence}`;
}

const KIND_LABELS: Record<Kind, string> = { bug: "Bug", idea: "Idea", question: "Question" };

/** The message's first non-blank line, cut to fit an issue title. */
export function issueTitle(report: Report): string {
  const line = report.message.split("\n").find((l) => l.trim())?.trim() ?? KIND_LABELS[report.kind];
  const title = line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
  return defuseMentions(title);
}

/** The issue body: the message as written, then the screenshots, then the diagnostics. */
export function issueBody(report: Report, imageUrls: string[]): string {
  const d = report.diagnostics;
  const parts: string[] = [defuseMentions(report.message.trim())];

  const facts = [`**${KIND_LABELS[report.kind]}**`, `KB25 ${defuseMentions(d.version)}`];
  facts.push(report.email ? `reply to ${defuseMentions(report.email)}` : "no reply address");
  parts.push(`---\n${facts.join(" · ")}`);

  if (imageUrls.length) {
    parts.push(
      "### Screenshots\n\n" +
        imageUrls.map((url, i) => `![Screenshot ${i + 1}](${url})`).join("\n\n")
    );
  }

  const rows: [string, string | undefined][] = [
    ["KB25", `${d.version} (${d.install})`],
    ["OS", d.os],
    ["Node", d.node],
    ["Browser", d.browser],
    ["Page", d.page],
  ];
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  const table = rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(([name, value]) => name.padEnd(width) + value)
    .join("\n");
  parts.push(`### Diagnostics\n\n${fenced(table)}`);

  if (d.errors?.length) {
    parts.push(
      `<details><summary>Errors in the browser (${d.errors.length})</summary>\n\n${fenced(d.errors.join("\n"))}\n\n</details>`
    );
  }
  if (d.logs) {
    parts.push(`<details><summary>Log tail</summary>\n\n${fenced(d.logs)}\n\n</details>`);
  }

  parts.push(`<sub>Report ${report.id}</sub>`);
  return parts.join("\n\n");
}
