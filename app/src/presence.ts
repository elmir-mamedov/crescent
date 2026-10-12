/**
 * Which browsers still have a KB25 tab open, for a server a launcher started
 * (KB25_DESKTOP). Each browser holds one event stream to GET /_presence (the
 * page's tabs elect one holder between them, see PRESENCE_SCRIPT in views.ts);
 * once the last stream has been gone for `graceMs`, `onIdle` quits the server.
 *
 * Nothing counts until a first stream connects, so a server started with no
 * browser (the installer's smoke test, the restart after an update) keeps
 * running as before. The grace period covers what drops a stream for a moment
 * without closing the app: a reload, a click to another page, the holder tab
 * closing while another tab takes over.
 */

/** The part of an HTTP response a stream is written through. */
export interface PresenceStream {
  write(chunk: string): unknown;
  end(): unknown;
}

export interface PresenceOptions {
  /** How long the last stream may be gone before `onIdle` runs. */
  graceMs: number;
  onIdle: () => void;
}

export interface Presence {
  /** Count `stream` as an open tab until the returned release is called. */
  connect(stream: PresenceStream): () => void;
  /**
   * End every stream as the server stops. `quitting` first tells each tab
   * KB25 has quit; without it (a restart, such as an update's) the tabs just
   * reconnect once the server is back.
   */
  endAll(quitting: boolean): void;
  /** Streams currently open. Exposed for tests. */
  size(): number;
}

export function makePresence(options: PresenceOptions): Presence {
  const streams = new Set<PresenceStream>();
  let armed = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function connect(stream: PresenceStream): () => void {
    streams.add(stream);
    armed = true;
    cancelIdle();
    return () => {
      if (!streams.delete(stream) || streams.size > 0 || !armed) return;
      cancelIdle();
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (streams.size === 0) options.onIdle();
      }, options.graceMs);
    };
  }

  function endAll(quitting: boolean): void {
    // Disarmed first, so the releases that ending the streams sets off never
    // start a second quit.
    armed = false;
    cancelIdle();
    for (const stream of streams) {
      try {
        if (quitting) stream.write("event: quit\ndata: \n\n");
        stream.end();
      } catch {}
    }
    streams.clear();
  }

  return { connect, endAll, size: () => streams.size };
}
