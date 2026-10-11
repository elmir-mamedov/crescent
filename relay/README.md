# KB25 feedback relay

> **Legacy.** KB25 now sends feedback through the shared relay built from
> [`@elmir-mamedov/feedback`](https://github.com/elmir-mamedov/feedback) (the
> private `elmir-mamedov/feedback-relay` repo). This Worker keeps running for
> copies of KB25 0.3.0 and earlier, which post to it; retire it once they
> have updated.

A Cloudflare Worker that turns feedback sent from KB25's **Send feedback**
dialog into issues in the private repo
[`elmir-mamedov/kb25-feedback`](https://github.com/elmir-mamedov/kb25-feedback).
Each copy of KB25 runs on its owner's machine, so this is the one place they
can all reach; it holds the GitHub token, so the copies don't.

A report is a message, a kind (`bug`, `idea` or `question`, which becomes the
issue's label), an optional reply address, up to five images, and the
diagnostics the person chose to include. Images are committed to the repo
under `reports/<report id>/` and shown in the issue. The limits that matter
are enforced here, in `src/report.ts`: anyone can read this URL in the app's
source.

## Develop

```bash
cd relay
npm install
npm run typecheck
npm test
npm run dev        # local Worker on http://localhost:8787; reports still go to GitHub
```

Point a local KB25 at it with `KB25_FEEDBACK_URL=http://localhost:8787/reports`.
For `npm run dev`, put the token in `relay/.dev.vars` as `GITHUB_TOKEN=...`
(git-ignored).

## Deploy

1. Create a fine-grained token at
   <https://github.com/settings/personal-access-tokens/new>: only the
   `kb25-feedback` repository, with **Contents** and **Issues** set to
   read and write.
2. Store it: `npx wrangler secret put GITHUB_TOKEN`.
3. `npm run deploy`.

Swapping the token later is step 2 again; no redeploy is needed.

GitHub doesn't notify you about issues your own token opens. To get an email
for each report, watch the repo (All Activity) and turn on **Include your own
updates** under Settings → Notifications → Email.
