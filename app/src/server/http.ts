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

export function safeRedirectPath(value: string | null): string {
  // Browsers read a backslash as a slash in a URL path, so "/\evil.com" leaves
  // the site exactly like "//evil.com" does.
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (value === "/_login" || value.startsWith("/_login?")) return "/";
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
