/**
 * Feedback to the developer (feedback.ts). GET answers what a report would
 * carry besides the person's own words, for the dialog to show before
 * sending; POST sends it through the relay, or queues it when the relay is
 * out of reach.
 */
import type { FastifyInstance } from "fastify";
import { FEEDBACK_BODY_LIMIT, type Feedback } from "../feedback.js";

export async function registerFeedbackRoutes(app: FastifyInstance, feedback: Feedback): Promise<void> {
  app.get("/_feedback", async (_req, reply) => reply.send(feedback.info()));
  // The dialog posts a report as the multipart the relay takes, read here as
  // raw bytes. The parser is scoped to this route; nothing else takes multipart.
  await app.register(async (scope) => {
    scope.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/_feedback", { bodyLimit: FEEDBACK_BODY_LIMIT }, async (req, reply) => {
      const result = await feedback.submit(req.body as Buffer, req.headers["content-type"] ?? "");
      return reply.code(result.status === "refused" ? 400 : result.status === "sent" ? 200 : 202).send(result);
    });
  });
}
