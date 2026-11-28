/**
 * Reading what a request sent, and the paths a reply points at: the helpers
 * the route modules share.
 */
import type { FastifyInstance } from "fastify";

/** Forms arrive URL-encoded, read into the object formString takes apart. */
export function registerFormParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      // A repeated key (several ticked `label` checkboxes) collects into an array;
      // formString still reads one value, the last, as before. No prototype, so a
      // field named __proto__ is just a field.
      const parsed: Record<string, string | string[]> = Object.create(null);
      const rawBody = typeof body === "string" ? body : body.toString("utf8");
      for (const [key, value] of new URLSearchParams(rawBody)) {
        const previous = parsed[key];
        parsed[key] =
          previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
      }
      done(null, parsed);
    }
  );
}

/** A base no real address shares, to tell a path on this server from one that leaves it. */
const REDIRECT_BASE = new URL("http://crescent.invalid");

/**
 * Where a redirect a request asked for (`/_login?next=`, a label form's
 * `returnTo`) may go: a path on this server, else "/". A browser reading the
 * Location header takes a backslash for a slash and drops tabs and newlines,
 * so "/\evil.com" and "/<TAB>/evil.com" leave the site exactly like
 * "//evil.com" does. Any whitespace or control character is refused, and what
 * is left is read the way a browser reads it, and kept only if it stays here.
 */
export function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || /[\\\s\x00-\x1f\x7f]/.test(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, REDIRECT_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== REDIRECT_BASE.origin || url.pathname === "/_login") return "/";
  return value;
}

export function queryString(query: unknown, field: string): string | null {
  if (!query || typeof query !== "object") return null;
  const value = (query as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/** Every value of a repeated query parameter (`?label=a&label=b`), in order. */
export function queryStrings(query: unknown, field: string): string[] {
  if (!query || typeof query !== "object") return [];
  const value = (query as Record<string, unknown>)[field];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formString(body: unknown, field: string): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[field];
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === "string" ? last : null;
  }
  return typeof value === "string" ? value : null;
}

/** Every value a form sent under one name (ticked checkboxes), in order. */
export function formStrings(body: unknown, field: string): string[] {
  if (!body || typeof body !== "object") return [];
  const value = (body as Record<string, unknown>)[field];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function pagePath(slug: string): string {
  if (!slug) return "/";
  return "/" + slug.split("/").map(encodeURIComponent).join("/");
}

/**
 * A Content-Disposition that downloads a file as `filename`. A header can
 * carry only Latin-1, so a name past it ("částice-website.zip") goes in
 * `filename*` as UTF-8, with an ASCII stand-in in `filename` for a client
 * that doesn't read that.
 */
export function attachment(filename: string): string {
  const ascii = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]|["\\]/g, "_");
  if (ascii === filename) return `attachment; filename="${filename}"`;
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
