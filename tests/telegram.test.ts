import { expect, test } from "bun:test";
import { instantMessage } from "../src/telegram";
import type { StoredJob } from "../src/types";

test("instant message escapes third-party HTML", () => {
  const job: StoredJob = {
    id: "1",
    fingerprint: "abc",
    title: "Customer Success <Lead>",
    company: "SaaS & Co",
    location: "Praha",
    remoteMode: "hybrid",
    description: null,
    canonicalUrl: "https://example.test/job",
    publishedAt: "2026-08-08T08:00:00.000Z",
    tier: "strong",
    matchedRules: ["customer_success"],
    negativeRules: [],
    locationConfirmed: true,
    firstSeenAt: "2026-08-08T08:00:00.000Z",
    instantAlertSentAt: null,
  };
  const message = instantMessage(job, "startupjobs");
  expect(message).toContain("Customer Success &lt;Lead&gt;");
  expect(message).toContain("SaaS &amp; Co");
  expect(message).toContain("Otevřít nabídku");
});
