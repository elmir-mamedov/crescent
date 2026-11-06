/** A space's image gallery: uploading images to it, and deleting them. */
import type { FastifyInstance } from "fastify";
import type { SpaceInfo } from "../content.js";
import { GALLERY_BODY_LIMIT, listImages, makeRecentDeletions, uploadRefusal } from "../gallery.js";
import { galleryLayout, notFound, type ViewNotice } from "../views.js";
import type { ServerContext } from "./context.js";
import { errorMessage, formString, queryString, queryStrings } from "./http.js";

export async function registerGalleryRoutes(app: FastifyInstance, ctx: ServerContext): Promise<void> {
  const { siteTitle, username, content, writes } = ctx;
  const { dashboardSpace, findSpace, spaceChrome } = ctx.render;
  const deletions = makeRecentDeletions();

  /**
   * The gallery for one space. `added` names the images just uploaded, which the
   * grid marks, and `deleted` the one just deleted, which the caller has
   * claimed from `deletions`; a name that does not match what is there is
   * dropped, so a stale or typed URL claims nothing.
   */
  async function renderGallery(
    space: SpaceInfo,
    options: { added?: string[]; deleted?: string; notice?: ViewNotice } = {}
  ): Promise<string> {
    const filter = space.archived ? "all" : "live";
    const [spaces, { tree, labelSet }, titles, images] = await Promise.all([
      content.spaces(),
      spaceChrome(space.key, filter),
      content.titleIndex(),
      listImages(content, space.key),
    ]);
    const added = (options.added ?? []).filter((p) => images.some((image) => image.path === p));
    const deleted = options.deleted && !images.some((image) => image.path === options.deleted) ? options.deleted : "";
    const done = added.length === 1
      ? `Uploaded ${added[0]}.`
      : added.length
        ? `Uploaded ${added.length} images.`
        : deleted
          ? `Deleted ${deleted}.`
          : "";
    const notice = options.notice ?? (done ? ({ tone: "success", text: done } satisfies ViewNotice) : undefined);

    return galleryLayout({
      siteTitle: siteTitle,
      spaces,
      spaceKey: space.key,
      tree,
      labelSet,
      titles,
      spaceTitle: space.title,
      images,
      added,
      notice,
      username: username,
    });
  }

  /** A space's image gallery — what the corner button beside the chat opens. */
  app.get("/_gallery", async (req, reply) => {
    const space = await dashboardSpace(req, reply);
    if (!space) return reply;
    const added = queryStrings(req.query, "added");
    const named = queryString(req.query, "deleted");
    const deleted = named && deletions.claim(space.key, named) ? named : undefined;
    return reply.type("text/html").send(await renderGallery(space, { added, deleted }));
  });

  /**
   * Delete one image, from the viewer's Delete. Refused while a page still
   * links to it, as kb_delete_image is: the gallery comes back naming those
   * pages, and the image stays.
   */
  app.post("/_gallery/delete", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const spaceKey = formString(req.body, "space") ?? "";
    const space = await findSpace(spaceKey);
    if (!space) {
      return reply.code(404).type("text/html").send(notFound(siteTitle, spaceKey, await content.spaces(), username));
    }
    const image = formString(req.body, "image") ?? "";
    const refuse = async (code: number, text: string) =>
      reply.code(code).type("text/html").send(await renderGallery(space, { notice: { tone: "error", text } }));

    let written: Awaited<ReturnType<typeof writes.deleteImage>>;
    try {
      written = image ? await writes.deleteImage(space.key, image) : null;
    } catch (err) {
      return refuse(400, errorMessage(err));
    }
    if (!written) return refuse(404, `There is no image _assets/${image} in this space.`);

    const { mutation, commitError } = written;
    if (mutation.linkedFrom.length) {
      const pages = mutation.linkedFrom.map((page) => `“${page.title}” (${page.slug || "home page"})`);
      const list = pages.length === 1 ? pages[0] : `${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
      const them = pages.length === 1 ? "that page" : "those pages";
      return refuse(409, `Not deleted: ${mutation.path} is still on ${list}. Take it off ${them} first.`);
    }
    if (commitError) return refuse(500, `Deleted, but Git commit failed: ${commitError}`);

    deletions.record(space.key, mutation.path);
    const query = new URLSearchParams({ space: space.key, deleted: mutation.path });
    return reply.redirect(`/_gallery?${query}`, 303);
  });

  // An upload is an ordinary multipart form, read with the platform's own
  // Response.formData(). Like feedback's, the parser is scoped to this route,
  // and so is the error handler that turns an upload over the limit into the
  // gallery with a notice rather than a bare JSON error.
  await app.register(async (scope) => {
    scope.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.setErrorHandler(async (err, req, reply) => {
      const space = err.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? await findSpace(queryString(req.query, "space") ?? "") : null;
      if (!space) throw err;
      const limit = Math.round(GALLERY_BODY_LIMIT / (1024 * 1024));
      const notice = {
        tone: "error",
        text: `That upload is over ${limit} MB. Upload fewer images at once, or smaller ones.`,
      } satisfies ViewNotice;
      return reply.code(413).type("text/html").send(await renderGallery(space, { notice }));
    });

    scope.post("/_gallery", { bodyLimit: GALLERY_BODY_LIMIT }, async (req, reply) => {
      const space = await dashboardSpace(req, reply);
      if (!space) return reply;
      const refuse = async (code: number, text: string) =>
        reply.code(code).type("text/html").send(await renderGallery(space, { notice: { tone: "error", text } }));

      let files: File[];
      try {
        // The parser hands over a Buffer, whose memory is a plain ArrayBuffer.
        const form = await new Response(req.body as Uint8Array<ArrayBuffer>, {
          headers: { "content-type": req.headers["content-type"] ?? "" },
        }).formData();
        // A form sent with no file chosen still carries one empty, nameless entry.
        files = form
          .getAll("image")
          .filter((entry): entry is File => typeof entry !== "string" && (entry.name !== "" || entry.size > 0));
      } catch {
        return refuse(400, "Could not read the upload. Try again.");
      }
      const refusal = uploadRefusal(files);
      if (refusal) return refuse(400, refusal);

      // Everything was checked above, so a failure here is the disk's. What was
      // saved before it is still committed and shown.
      const { mutation, commitError } = await writes.addImages(space.key, files);
      const { saved } = mutation;
      const failure =
        mutation.saveError ?? (commitError ? `Uploaded, but Git commit failed: ${commitError}` : "");
      if (failure) {
        const html = await renderGallery(space, {
          added: saved.map((image) => image.path),
          notice: { tone: "error", text: failure },
        });
        return reply.code(500).type("text/html").send(html);
      }

      const query = new URLSearchParams({ space: space.key });
      for (const image of saved) query.append("added", image.path);
      return reply.redirect(`/_gallery?${query}`, 303);
    });
  });
}
