/**
 * Whether a bind address only accepts connections from this machine. Gates
 * AUTH_DISABLED: an open KB is fine on loopback and never on anything wider.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}

/** The request headers crossSiteRefusal judges by. */
export interface RequestOrigin {
  method: string;
  host?: string;
  origin?: string;
  secFetchSite?: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Why a request to a sign-in-off viewer must be refused, or null when it may
 * proceed. With no session to check, the browser itself is the threat: a Host
 * that is not loopback means a DNS-rebinding page is reading the KB through a
 * name it controls, and a write whose Origin is another site is a forged form
 * post. Clients that are not browsers (curl, scripts) send neither Origin nor
 * Sec-Fetch-Site, and pass.
 */
export function crossSiteRefusal(req: RequestOrigin): string | null {
  const host = urlHost(`http://${req.host ?? ""}`);
  if (!host || !isLoopbackHost(new URL(`http://${host}`).hostname)) {
    return "Crescent only answers to localhost.";
  }
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;
  if (req.origin !== undefined) {
    return urlHost(req.origin) === host ? null : "Crescent refuses changes sent from another site.";
  }
  if (req.secFetchSite && req.secFetchSite !== "same-origin" && req.secFetchSite !== "none") {
    return "Crescent refuses changes sent from another site.";
  }
  return null;
}

/** host[:port] of a URL, normalized the way browsers write it; null if unparsable. */
function urlHost(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
