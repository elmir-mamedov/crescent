import { Buffer } from "node:buffer";
import { MAX_BODY_BYTES, imagePath, issueBody, issueTitle, readReportForm, type Report } from "./report.ts";

/**
 * The feedback relay: KB25 copies POST /reports here, and each report becomes
 * an issue in a private GitHub repo, its images committed beside it. The
 * GitHub token lives only in this Worker's secrets; the copies hold nothing
 * but this URL, which is public, so every limit is enforced here.
 */

export interface Env {
  /** Fine-grained token: Contents and Issues, read and write, on GITHUB_REPO only. */
  GITHUB_TOKEN: string;
  /** "owner/name" of the private repo the reports land in. */
  GITHUB_REPO: string;
  /**
   * A few reports a minute from one address; see wrangler.toml. Typed by
   * shape rather than as Workers' RateLimit, so the tests can run this file
   * under Node with a stand-in.
   */
  PER_IP: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/reports") return json(404, { error: "Not found." });
    if (request.method !== "POST") return json(405, { error: "POST a report to /reports." });

    // Refuse an oversized body before reading it; a sender that won't say
    // how big its body is gets refused too.
    const length = Number(request.headers.get("content-length"));
    if (!Number.isFinite(length) || length <= 0) return json(411, { error: "Send a Content-Length." });
    if (length > MAX_BODY_BYTES) return json(413, { error: "The report is too large." });

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.PER_IP.limit({ key: ip })).success) {
      return json(429, { error: "Too many reports from here. Try again in a minute." });
    }

    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      return json(415, { error: "Send the report as multipart/form-data." });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json(400, { error: "The report is malformed." });
    }
    const parsed = await readReportForm(form);
    if (!parsed.ok) return json(400, { error: parsed.error });

    try {
      const issue = await fileIssue(parsed.report, env);
      return json(201, { ok: true, issue });
    } catch (error) {
      console.error(`report ${parsed.report.id}:`, error);
      return json(502, { error: "The report could not be filed. It will be retried." });
    }
  },
};

function github(env: Env, method: string, path: string, body: string): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "kb25-feedback-relay",
      "x-github-api-version": "2022-11-28",
    },
    body,
  });
}

async function failure(response: Response, what: string): Promise<Error> {
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  return new Error(`${what}: GitHub answered ${response.status} ${detail}`);
}

/**
 * Commit one image to the repo's default branch. One at a time: commits to
 * the same branch race, and GitHub answers the loser 409, which gets one
 * retry. 422 means the path is taken, which only a retried report hits (the
 * paths are keyed by its id), so the image is already there.
 */
async function commitImage(env: Env, report: Report, index: number): Promise<string> {
  const path = imagePath(report, index);
  const { data } = report.images[index];
  // Spliced in rather than passed through JSON.stringify, which would scan the
  // megabytes of base64 again for characters it never contains.
  const content = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
  const message = JSON.stringify(`Add image ${index + 1} of report ${report.id}`);
  const body = `{"message":${message},"content":"${content}"}`;
  for (let attempt = 0; ; attempt++) {
    const response = await github(env, "PUT", `/contents/${path}`, body);
    if (response.ok || response.status === 422) break;
    if (response.status !== 409 || attempt > 0) throw await failure(response, `image ${index + 1}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  // Opened on github.com, a private repo's file loads with the viewer's own
  // session, so the screenshot shows inline for the owner and nobody else.
  return `https://github.com/${env.GITHUB_REPO}/blob/HEAD/${path}?raw=true`;
}

async function fileIssue(report: Report, env: Env): Promise<number> {
  const urls: string[] = [];
  for (let i = 0; i < report.images.length; i++) urls.push(await commitImage(env, report, i));
  const response = await github(
    env,
    "POST",
    "/issues",
    JSON.stringify({ title: issueTitle(report), body: issueBody(report, urls), labels: [report.kind] })
  );
  if (!response.ok) throw await failure(response, "issue");
  const issue = (await response.json()) as { number: number };
  return issue.number;
}
