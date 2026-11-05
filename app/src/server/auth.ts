/**
 * Sign-in: one static credential pair behind a failed-attempt cooldown, and a
 * signed session cookie that every other route asks for. With sign-in off
 * there is no session to ask for, so a request from another site is turned
 * away instead.
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { makeLoginThrottle, retryAfterWords } from "../login-throttle.js";
import { crossSiteRefusal } from "../loopback.js";
import { loginLayout } from "../views.js";
import { formString, queryString, safeRedirectPath } from "./http.js";
import { PUBLIC_PATHS } from "./static.js";

export interface AuthOptions {
  siteTitle: string;
  /** AUTH_DISABLED, which the server allows on a loopback HOST only. */
  disabled: boolean;
  username: string;
  password: string;
  sessionSecret: string;
  /** KB25_DESKTOP: KB25's window, which has no session, listens on GET /_window. */
  desktop: boolean;
}

const SESSION_COOKIE = "kb_session";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function requestPath(req: FastifyRequest): string {
  return new URL(req.url, "http://localhost").pathname;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      continue;
    }
  }

  return cookies;
}

/**
 * Constant-time string comparison. Both sides are digested first so the compare
 * always runs over two 32-byte buffers: `timingSafeEqual` throws on a length
 * mismatch, and short-circuiting on one would time out the secret's length.
 */
function timingSafeEqualString(left: string, right: string): boolean {
  const digest = (value: string) =>
    crypto.createHash("sha256").update(value, "utf8").digest();
  return crypto.timingSafeEqual(digest(left), digest(right));
}

/**
 * `Secure` is set from the scheme the request arrived on rather than hardcoded
 * either way. Over HTTPS it keeps the session off any cleartext hop; over the
 * default loopback HTTP it must stay off, because a browser drops a `Secure`
 * cookie sent in the clear and the sign-in would silently never take.
 */
function cookieAttributes(req: FastifyRequest): string {
  return `Path=/; HttpOnly; SameSite=Lax${req.protocol === "https" ? "; Secure" : ""}`;
}

function sessionCookie(token: string, req: FastifyRequest): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(
    req
  )}; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function clearSessionCookie(req: FastifyRequest): string {
  // Same attributes as the cookie being cleared, or the browser keeps the old one.
  return `${SESSION_COOKIE}=; ${cookieAttributes(req)}; Max-Age=0`;
}

export function registerAuth(app: FastifyInstance, auth: AuthOptions): void {
  // Repeated wrong passwords cost the caller a cooldown; one account means an
  // unthrottled form would otherwise answer guesses as fast as they arrive.
  const loginThrottle = makeLoginThrottle();

  function sign(value: string): string {
    return crypto
      .createHmac("sha256", auth.sessionSecret)
      .update(value)
      .digest("base64url");
  }

  function createSession(username: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
        user: username,
      }),
      "utf8"
    ).toString("base64url");
    return `${payload}.${sign(payload)}`;
  }

  function readSession(token: string | undefined): string | null {
    if (!token) return null;

    const [payload, signature] = token.split(".");
    if (!payload || !signature || !timingSafeEqualString(signature, sign(payload))) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        exp?: unknown;
        user?: unknown;
      };
      if (parsed.user !== auth.username) return null;
      if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
      return parsed.user;
    } catch {
      return null;
    }
  }

  function currentUser(req: FastifyRequest): string | null {
    return readSession(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
  }

  app.addHook("onRequest", async (req, reply) => {
    if (auth.disabled) return;
    const reqPath = requestPath(req);
    if (reqPath === "/_login") return;
    if (PUBLIC_PATHS.has(reqPath)) return; // site icons load before sign-in
    // Carries no KB data; KB25's window (shell/) has no session to send.
    if (auth.desktop && reqPath === "/_window") return;
    if (currentUser(req)) return;

    const next = encodeURIComponent(req.url || "/");
    return reply.redirect(`/_login?next=${next}`, 303);
  });

  // With sign-in off there is no session for a forged request to lack, so any
  // page in the browser could otherwise post forms here or, by DNS rebinding,
  // read the KB. The browser's own Host/Origin headers tell those apart.
  app.addHook("onRequest", async (req, reply) => {
    if (!auth.disabled) return;
    const secFetchSite = req.headers["sec-fetch-site"];
    const refusal = crossSiteRefusal({
      method: req.method,
      host: req.headers.host,
      origin: req.headers.origin,
      secFetchSite: Array.isArray(secFetchSite) ? secFetchSite[0] : secFetchSite,
    });
    if (refusal) return reply.code(403).type("text/plain").send(refusal);
  });

  app.get("/_login", async (req, reply) => {
    const next = safeRedirectPath(queryString(req.query, "next"));
    if (auth.disabled || currentUser(req)) return reply.redirect(next);

    return reply.type("text/html").send(
      loginLayout({
        siteTitle: auth.siteTitle,
        next,
      })
    );
  });

  app.post("/_login", async (req, reply) => {
    const next = safeRedirectPath(formString(req.body, "next"));
    if (auth.disabled) return reply.redirect(next, 303);
    const username = formString(req.body, "username") ?? "";
    const password = formString(req.body, "password") ?? "";

    /** The cooled-off form: 429 so a caller's tooling sees the refusal for what it is. */
    const lockedOut = (retryAfterSeconds: number) =>
      reply
        .code(429)
        .header("retry-after", String(retryAfterSeconds))
        .type("text/html")
        .send(
          loginLayout({
            siteTitle: auth.siteTitle,
            error: `Too many failed sign-ins. Try again in ${retryAfterWords(
              retryAfterSeconds
            )}.`,
            next,
            username,
          })
        );

    // Asked before the password is read, so a locked-out caller learns nothing
    // from the answer it gets.
    const gate = loginThrottle.check(req.ip);
    if (!gate.allowed) return lockedOut(gate.retryAfterSeconds);

    // Both compared, and neither with `===`: `&&` would skip the password check on
    // a wrong username, timing out which half was wrong, and a plain `===` returns
    // as soon as two bytes differ, timing out how much of a guess was right.
    const usernameOk = timingSafeEqualString(username, auth.username);
    const passwordOk = timingSafeEqualString(password, auth.password);
    if (usernameOk && passwordOk) {
      loginThrottle.recordSuccess(req.ip);
      return reply
        .header("set-cookie", sessionCookie(createSession(username), req))
        .redirect(next, 303);
    }

    const after = loginThrottle.recordFailure(req.ip);
    if (!after.allowed) return lockedOut(after.retryAfterSeconds);

    return reply.code(401).type("text/html").send(
      loginLayout({
        siteTitle: auth.siteTitle,
        error: "The username or password is incorrect.",
        next,
        username,
      })
    );
  });

  app.post("/_logout", async (req, reply) => {
    return reply.header("set-cookie", clearSessionCookie(req)).redirect("/_login", 303);
  });
}
