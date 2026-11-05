import { themeToggle } from "./corner.js";
import { renderHead } from "./head.js";
import { escapeHtml } from "./html.js";

/**
 * The sign-in page.
 */

export interface LoginView {
  siteTitle: string;
  error?: string;
  next: string;
  username?: string;
}

export function loginLayout(v: LoginView): string {
  const error = v.error
    ? `<div class="notice error">${escapeHtml(v.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
${renderHead(`Sign in · ${escapeHtml(v.siteTitle)}`)}
<body class="login-page">
<div class="session-corner">${themeToggle()}</div>
<main class="login-panel">
  <h1>${escapeHtml(v.siteTitle)}</h1>
  <p class="login-subtitle">Sign in to continue.</p>
  ${error}
  <form class="login-form" method="post" action="/_login">
    <input type="hidden" name="next" value="${escapeHtml(v.next)}" />
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" value="${escapeHtml(
      v.username ?? ""
    )}" autofocus required />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button class="button primary" type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;
}
