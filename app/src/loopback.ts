/**
 * Whether a bind address only accepts connections from this machine. Gates
 * AUTH_DISABLED: an open KB is fine on loopback and never on anything wider.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}
