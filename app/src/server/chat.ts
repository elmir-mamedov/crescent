/**
 * The chat drawer's routes (chat.ts runs the turns): which engines can answer,
 * the threads, a message sent to one with the images attached to it, and its
 * turn as it happens.
 */
import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { assetHeaders } from "../assets.js";
import type { ChatMessage, IncomingImage } from "../chat-store.js";
import { messageView, type Chat, type ChatMessageView, type RunEvent, type SendInput } from "../chat.js";
import { flatten } from "../content.js";
import { GALLERY_BODY_LIMIT, imageType } from "../gallery.js";
import { createRenderer } from "../markdown.js";
import { galleryHref } from "../views.js";
import type { ServerContext } from "./context.js";
import { pagePath } from "./http.js";

function chatThreadId(req: FastifyRequest): string {
  return (req.params as { id: string }).id;
}

/** Where an image attached to a message of thread `id` is served. */
function imagePath(id: string, name: string): string {
  return `/_chat/threads/${id}/images/${encodeURIComponent(name)}`;
}

type MessageFields = Omit<SendInput, "images"> & { images: IncomingImage[] };

/**
 * A message as the drawer sends it: a multipart form, its images as `image`
 * files and the model's copy of the n-th as `view-<n>`; or, from a page loaded
 * before images could be attached, JSON. Null when the form cannot be read.
 */
async function readMessage(req: FastifyRequest): Promise<MessageFields | null> {
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("multipart/form-data")) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return { ...messageFields((key) => body[key]), forcePages: body.forcePages === true, images: [] };
  }
  let form: FormData;
  try {
    // The parser hands over a Buffer, whose memory is a plain ArrayBuffer.
    form = await new Response(req.body as Uint8Array<ArrayBuffer>, { headers: { "content-type": type } }).formData();
  } catch {
    return null;
  }
  const files = form
    .getAll("image")
    .filter((entry): entry is File => typeof entry !== "string" && (entry.name !== "" || entry.size > 0));
  const images = await Promise.all(
    files.map(async (file, n): Promise<IncomingImage> => {
      const view = form.get(`view-${n}`);
      return {
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        ...(view && typeof view !== "string" && { view: new Uint8Array(await view.arrayBuffer()) }),
      };
    })
  );
  return { ...messageFields((key) => form.get(key) ?? undefined), forcePages: form.get("forcePages") === "true", images };
}

/** A message's fields other than the toggle and the images, each only when it is a string. */
function messageFields(field: (key: string) => unknown): Omit<SendInput, "forcePages" | "images"> {
  const text = (key: string) => {
    const value = field(key);
    return typeof value === "string" && value ? value : undefined;
  };
  const engine = text("engine");
  return {
    text: text("text") ?? "",
    slug: text("slug"),
    engine: engine === "claude" || engine === "codex" ? engine : undefined,
    model: text("model"),
    effort: text("effort"),
  };
}

export async function registerChatRoutes(app: FastifyInstance, ctx: ServerContext, chat: Chat): Promise<void> {
  const { content } = ctx;

  /** A thread's messages as the drawer shows them, rendered against the KB as it is now. */
  async function chatViews(id: string, messages: ChatMessage[]): Promise<ChatMessageView[]> {
    const [titles, ids, pages] = await Promise.all([
      content.titleIndex(),
      content.idIndex(),
      content.tree("all").then(flatten),
    ]);
    const md = createRenderer((s) => titles.get(s), "", (id) => ids.get(id));
    return messages.map((message) =>
      messageView(message, {
        render: (text) => md.render(text),
        pages,
        href: pagePath,
        gallery: galleryHref,
        image: (name) => imagePath(id, name),
      })
    );
  }

  app.get("/_chat/status", async (req, reply) => {
    const fresh = (req.query as { fresh?: string }).fresh === "1";
    return reply.header("cache-control", "no-store").send({ engines: await chat.status(fresh) });
  });

  app.get("/_chat/threads", async (_req, reply) => {
    return reply.header("cache-control", "no-store").send({ threads: await chat.list() });
  });

  app.get("/_chat/threads/:id", async (req, reply) => {
    const id = chatThreadId(req);
    const thread = await chat.thread(id);
    if (!thread) return reply.code(404).send({ error: "No such chat." });
    return reply.header("cache-control", "no-store").send({
      id: thread.id,
      title: thread.title,
      engine: thread.engine,
      running: chat.running(id),
      messages: await chatViews(id, thread.messages),
    });
  });

  // A message with images is a multipart form, read with the platform's own
  // Response.formData(); as for the gallery's upload, the parser and the
  // larger body limit are scoped to this route.
  await app.register(async (scope) => {
    scope.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.setErrorHandler(async (err, _req, reply) => {
      if (err.code !== "FST_ERR_CTP_BODY_TOO_LARGE") throw err;
      const limit = Math.round(GALLERY_BODY_LIMIT / (1024 * 1024));
      return reply.code(413).send({ error: `Those images are over ${limit} MB together. Attach fewer, or smaller ones.` });
    });

    scope.post("/_chat/threads/:id/messages", { bodyLimit: GALLERY_BODY_LIMIT }, async (req, reply) => {
      const message = await readMessage(req);
      if (!message) return reply.code(400).send({ error: "Could not read the message. Try again." });
      const sent = await chat.send(chatThreadId(req), message);
      if (!sent.ok) return reply.code(sent.status).send({ error: sent.error, engine: sent.engine });
      return reply.code(202).send({ ok: true, title: sent.thread.title });
    });
  });

  /**
   * An image attached to a message, for the drawer to show. Sent with an
   * asset's headers (assets.ts): it came from the person's disk, and an SVG
   * opened on its own must not run as Crescent.
   */
  app.get("/_chat/threads/:id/images/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const file = await chat.imageFile(id, name);
    if (!file) return reply.code(404).send({ error: "No such image." });
    return reply
      .headers(assetHeaders(name))
      .header("cache-control", "private, max-age=3600")
      .type(imageType(name) ?? "application/octet-stream")
      .send(createReadStream(file));
  });

  // A turn as it happens: what it has said so far, then the rest live, ending
  // with a `done` event. With nothing running it is `done` at once, so a page
  // that reconnects after the turn ended (or after a restart) knows to reload.
  app.get("/_chat/threads/:id/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    reply.raw.write("retry: 2000\n\n");
    // Finished messages are rendered before they go out; the chain keeps the
    // events in the order they happened.
    let queue: Promise<void> = Promise.resolve();
    const send = (event: RunEvent) => {
      queue = queue.then(async () => {
        let out: unknown = event;
        if (event.type === "user" || event.type === "message") {
          out = { type: event.type, message: (await chatViews(chatThreadId(req), [event.message]))[0] };
        }
        if (reply.raw.writableEnded) return;
        reply.raw.write(`data: ${JSON.stringify(out)}\n\n`);
        if (event.type === "done") reply.raw.end();
      });
    };
    const unsubscribe = chat.subscribe(chatThreadId(req), send);
    if (!unsubscribe) send({ type: "done" });
    else reply.raw.on("close", unsubscribe);
  });

  app.post("/_chat/threads/:id/stop", async (req, reply) => {
    return reply.send({ ok: chat.stop(chatThreadId(req)) });
  });

  app.post("/_chat/threads/:id/delete", async (req, reply) => {
    const id = chatThreadId(req);
    if (chat.running(id)) return reply.code(409).send({ error: "This chat is still answering." });
    return reply.send({ ok: await chat.remove(id) });
  });
}
