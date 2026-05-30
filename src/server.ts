import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type { GithubPayAgent } from "./agent.js";
import { getTopicId, loadStore, topicMessageCount } from "./hcs.js";
import { TOPIC_NAMES, hashscanBase, mirrorBase, topicHashscanUrl } from "./networks.js";
import {
  type PayOnMergeResult,
  notifySlack,
  payOnMerge,
  sealReleaseProvenance,
  webClaim,
} from "./pay.js";
import { getAllReceipts } from "./resolve.js";
import type { TopicName } from "./types.js";

export type WebhookServerOptions = {
  agent: GithubPayAgent;
  webhookSecret: string;
  githubToken?: string;
  slackWebhookUrl?: string;
  /**
   * Demo glue (off unless set). For this one repo, a PR opened with a Hedera
   * account in its body auto-registers the author on IDENTITIES, so the public
   * self-serve demo is a single action. Generic deployments leave this unset and
   * contributors register explicitly via `register_contributor`.
   */
  demoAutoRegisterRepo?: string;
  /** Serve a static directory (the landing page) at `/`. */
  staticDir?: string;
  /** Enable the public demo API (/api/stats, /api/receipts, POST /api/claim). */
  demoApi?: { repo: string; label: string };
};

// Extract the first Hedera account id (0.0.x) from free text, e.g. a PR body.
function parseHederaAccount(text?: string): string | null {
  return text?.match(/0\.0\.\d+/)?.[0] ?? null;
}

// ─── HMAC validation (X-Hub-Signature-256) ────────────────────────────────────

/**
 * Verify GitHub's HMAC-SHA256 signature against the raw request body.
 * Returns true only on a constant-time match.
 */
export function verifySignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader?: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Pick the first payment-triggering label on the PR. Convention: any label the
// repo admin has configured a policy for. We forward every label and let
// pay_on_merge decide (it returns "skipped" for labels without a policy).
function paymentLabels(pr: { labels?: Array<{ name: string }> }): string[] {
  return (pr.labels ?? []).map((l) => l.name);
}

export function createWebhookServer(opts: WebhookServerOptions): Express {
  const { agent } = opts;
  const app = express();

  // Trust nginx reverse-proxy so req.ip is the real client IP.
  app.set("trust proxy", 1);

  // Capture the raw body for HMAC verification (must run before JSON parsing).
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // ─── Public demo API (opt-in) ─────────────────────────────────────────────────
  if (opts.demoApi) {
    const { repo, label } = opts.demoApi;
    const net = agent.network;

    // GET /api/stats — pool balance, totals, topics (for the landing page).
    app.get("/api/stats", async (_req: Request, res: Response) => {
      try {
        const store = loadStore();
        const receipts = await getAllReceipts(net);
        const totalPaid = receipts.reduce((s, r) => s + r.amountHbar, 0);
        const contributors = new Set(receipts.map((r) => r.hederaAccountId)).size;
        let poolBalance: number | null = null;
        try {
          const r = await fetch(`${mirrorBase(net)}/api/v1/accounts/${agent.payerAccountId}`);
          if (r.ok) poolBalance = ((await r.json()) as any).balance.balance / 1e8;
        } catch {}
        res.json({
          network: net,
          payerAccount: agent.payerAccountId,
          poolBalance,
          totalPaidHbar: totalPaid,
          payments: receipts.length,
          contributors,
          topics: TOPIC_NAMES.map((n) => ({
            name: n,
            id: store.topics[n],
            hashscan: store.topics[n] ? topicHashscanUrl(net, store.topics[n] as string) : null,
          })),
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    // GET /api/receipts — recent payments with Hashscan links.
    app.get("/api/receipts", async (req: Request, res: Response) => {
      try {
        const limit = Math.min(Number(req.query.limit) || 12, 50);
        const all = await getAllReceipts(net);
        const recent = all.slice(-limit).reverse();
        const base = topicHashscanUrl(net, getTopicId("RECEIPTS"));
        res.json({
          receiptsTopicHashscan: base,
          receipts: recent.map((r) => ({
            repo: r.repo,
            prNumber: r.prNumber,
            prUrl: r.prUrl,
            githubHandle: r.githubHandle,
            account: r.hederaAccountId,
            amountHbar: r.amountHbar,
            label: r.label,
            timestamp: r.timestamp,
            transactionHashscan: `${hashscanBase(net)}/transaction/${encodeURIComponent(r.transactionId)}`,
          })),
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    // POST /api/claim — the "Claim 10 HBAR" button. Cap- and rate-limited.
    const claimLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { status: "skipped", reason: "Too many claims from this IP. Please wait a bit." },
    });
    app.post("/api/claim", claimLimiter, async (req: Request, res: Response) => {
      try {
        const account = String((req.body as { account?: string }).account ?? "").trim();
        const result = await webClaim(
          agent.client,
          net,
          agent.payerAccountId,
          repo,
          label,
          account,
        );
        res.json(result);
      } catch (err) {
        res
          .status(500)
          .json({ status: "skipped", reason: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // ─── GET /health ────────────────────────────────────────────────────────────
  app.get("/health", async (_req: Request, res: Response) => {
    const store = loadStore();
    const topicStatus: Record<
      string,
      { id: string | null; messages?: number; ok: boolean; error?: string }
    > = {};
    let allOk = true;

    await Promise.all(
      TOPIC_NAMES.map(async (name: TopicName) => {
        const id = store.topics[name];
        if (!id) {
          topicStatus[name] = { id: null, ok: false, error: "not provisioned" };
          allOk = false;
          return;
        }
        try {
          const count = await topicMessageCount(agent.network, id);
          topicStatus[name] = { id, messages: count, ok: true };
        } catch (err) {
          topicStatus[name] = {
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
          allOk = false;
        }
      }),
    );

    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ok" : "degraded",
      network: agent.network,
      mirrorNode: mirrorBase(agent.network),
      payerAccount: agent.payerAccountId,
      topics: topicStatus,
      lastOperation: store.lastOperation,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── POST /webhook ───────────────────────────────────────────────────────────
  app.post("/webhook", async (req: Request, res: Response) => {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from("");
    const signature = req.header("X-Hub-Signature-256");

    // Validate BEFORE processing any payload.
    if (!verifySignature(opts.webhookSecret, rawBody, signature)) {
      res.status(401).json({ error: "Invalid or missing X-Hub-Signature-256 signature" });
      return;
    }

    const event = req.header("X-GitHub-Event");
    const payload = req.body as Record<string, any>;

    // Respond quickly; do the on-chain work but await it so retries are safe
    // (pay_on_merge is idempotent on the PR number regardless).
    try {
      if (event === "ping") {
        res.json({ ok: true, pong: true });
        return;
      }

      // Demo self-serve: auto-register the PR author from a Hedera account in the
      // PR body, so a single opened PR drives the whole flow. Gated to one repo.
      if (
        event === "pull_request" &&
        ["opened", "reopened", "edited", "ready_for_review"].includes(payload.action) &&
        opts.demoAutoRegisterRepo &&
        payload.repository?.full_name === opts.demoAutoRegisterRepo
      ) {
        const handle: string | undefined = payload.pull_request?.user?.login;
        const account = parseHederaAccount(payload.pull_request?.body);
        if (handle && account) {
          await agent.api.run("github_pay_register_contributor", {
            github_handle: handle,
            hedera_account_id: account,
          });
          res.json({ ok: true, event, action: payload.action, registered: { handle, account } });
          return;
        }
        res.json({ ok: true, event, action: payload.action, note: "no Hedera account in PR body" });
        return;
      }

      if (event === "pull_request" && payload.action === "closed" && payload.pull_request?.merged) {
        const pr = payload.pull_request;
        const repo: string = payload.repository?.full_name;
        const labels = paymentLabels(pr);

        const slackUrl = opts.slackWebhookUrl;
        const notify = slackUrl
          ? (paid: Extract<PayOnMergeResult, { status: "paid" }>) => notifySlack(slackUrl, paid)
          : undefined;

        const results: PayOnMergeResult[] = [];
        for (const label of labels) {
          const result = await payOnMerge(
            agent.client,
            agent.network,
            agent.payerAccountId,
            {
              repo,
              prNumber: pr.number,
              prUrl: pr.html_url,
              prAuthor: pr.user?.login,
              label,
            },
            notify,
          );
          results.push(result);
          // Once a label actually pays (or was already paid), stop — one PR pays once.
          if (result.status === "paid" || result.status === "already_paid") break;
        }

        res.json({ ok: true, event, results });
        return;
      }

      if (event === "release" && payload.action === "published") {
        const rel = payload.release;
        const repo: string = payload.repository?.full_name;
        const assetUrls: string[] = (rel.assets ?? []).map(
          (a: { browser_download_url: string }) => a.browser_download_url,
        );

        const result = await sealReleaseProvenance(
          agent.client,
          agent.network,
          agent.payerAccountId,
          {
            repo,
            tag: rel.tag_name,
            commitSha: rel.target_commitish,
            assetUrls,
          },
          opts.githubToken,
        );
        res.json({ ok: true, event, provenance: result });
        return;
      }

      res.json({ ok: true, ignored: event, action: payload.action });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── Static landing page (opt-in) ─────────────────────────────────────────────
  if (opts.staticDir) {
    app.use(express.static(opts.staticDir));
  }

  return app;
}
