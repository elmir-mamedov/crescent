/**
 * The chat drawer's routes (chat.ts runs the turns): which engines can answer,
 * the threads, a message sent to one, and its turn as it happens.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ChatMessage } from "../chat-store.js";
import { messageView, type Chat, type ChatMessageView, type RunEvent } from "../chat.js";
import { flatten } from "../content.js";
import { createRenderer } from "../markdown.js";
import { galleryHref } from "../views.js";
import type { ServerContext } from "./context.js";
import { pagePath } from "./http.js";

function chatThreadId(req: FastifyRequest): string {
  return (req.params as { id: string }).id;
}

export function registerChatRoutes(app: FastifyInstance, ctx: ServerContext, chat: Chat): void {
  const { content } = ctx;

  /** A thread message as the drawer shows it, rendered against the KB as it is now. */
  async function chatViews(messages: ChatMessage[]): Promise<ChatMessageView[]> {
    const [titles, ids, pages] = await Promise.all([
      content.titleIndex(),
      content.idIndex(),
      content.tree("all").then(flatten),
    ]);
    const md = createRenderer((s) => titles.get(s), "", (id) => ids.get(id));
    return messages.map((message) =>
      messageView(message, { render: (text) => md.render(text), pages, href: pagePath, gallery: galleryHref })
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
      messages: await chatViews(thread.messages),
    });
  });

  app.post("/_chat/threads/:id/messages", async (req, reply) => {
    const body = (req.body ?? {}) as {
      text?: unknown;
      forcePages?: unknown;
      slug?: unknown;
      engine?: unknown;
      model?: unknown;
      effort?: unknown;
    };
    const sent = await chat.send(chatThreadId(req), {
      text: typeof body.text === "string" ? body.text : "",
      forcePages: body.forcePages === true,
      slug: typeof body.slug === "string" && body.slug ? body.slug : undefined,
      engine: body.engine === "claude" || body.engine === "codex" ? body.engine : undefined,
      model: typeof body.model === "string" && body.model ? body.model : undefined,
      effort: typeof body.effort === "string" && body.effort ? body.effort : undefined,
    });
    if (!sent.ok) return reply.code(sent.status).send({ error: sent.error, engine: sent.engine });
    return reply.code(202).send({ ok: true, title: sent.thread.title });
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
          out = { type: event.type, message: (await chatViews([event.message]))[0] };
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
