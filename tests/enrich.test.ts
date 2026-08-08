import { describe, expect, test } from "bun:test";
import { needsBasics } from "../src/enrich";
import type { NormalizedJob, RelevanceResult } from "../src/types";

const job: NormalizedJob = {
  title: "Customer Success Manager",
  company: "Example SaaS, s.r.o.",
  location: "Praha",
  remoteMode: "hybrid",
  description: "B2B onboarding.",
  canonicalUrl: "https://example.test/job/1",
  publishedAt: "2026-08-08T08:00:00.000Z",
};

const strong: RelevanceResult = {
  tier: "strong",
  matchedRules: ["customer_success"],
  negativeRules: [],
  locationConfirmed: true,
};

describe("paid enrichment triggers", () => {
  test("leaves a complete job alone", () => {
    expect(needsBasics(job, strong, "jobs_cz")).toBe(false);
  });

  test("pays to find a missing location on any source", () => {
    expect(needsBasics({ ...job, location: null }, strong, "jobs_cz")).toBe(true);
    expect(needsBasics({ ...job, location: null }, strong, "datacruit")).toBe(true);
  });

  test("pays to find a missing employer, except on anonymous agency boards", () => {
    expect(needsBasics({ ...job, company: null }, strong, "jobs_cz")).toBe(true);
    expect(needsBasics({ ...job, company: null }, strong, "datacruit")).toBe(false);
  });

  test("never pays for a job that is not a strong match", () => {
    const adjacent: RelevanceResult = { ...strong, tier: "adjacent" };
    expect(needsBasics({ ...job, company: null, location: null }, adjacent, "jobs_cz")).toBe(false);
  });
});
