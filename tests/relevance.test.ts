import { describe, expect, test } from "bun:test";
import { createFingerprint, evaluateRelevance, isStrictHighFit } from "../src/relevance";
import type { NormalizedJob } from "../src/types";

const baseJob: NormalizedJob = {
  title: "Customer Success Manager",
  company: "Example SaaS, s.r.o.",
  location: "Praha",
  remoteMode: "hybrid",
  description: "B2B onboarding and customer adoption.",
  canonicalUrl: "https://example.test/job/1",
  publishedAt: "2026-08-08T08:00:00.000Z",
};

describe("deterministic relevance", () => {
  test("marks a Prague core role as strong and instant-alert eligible", () => {
    const result = evaluateRelevance(baseJob);
    expect(result.tier).toBe("strong");
    expect(result.negativeRules).toEqual([]);
    expect(isStrictHighFit(baseJob, result, new Date("2026-08-08T10:00:00.000Z"))).toBe(true);
  });

  test("rejects a hydrated job that names neither employer nor place", () => {
    const job = { ...baseJob, company: null, location: null };
    const result = evaluateRelevance(job, { requireIdentity: true });
    expect(result.tier).toBe("filtered_out");
    expect(result.negativeRules).toContain("missing_company_and_location");
  });

  test("keeps an anonymous agency posting that still names the place", () => {
    const job = { ...baseJob, company: null };
    expect(evaluateRelevance(job, { requireIdentity: true }).tier).toBe("strong");
  });

  test("leaves the discovery preview untouched so listings still get hydrated", () => {
    const job = { ...baseJob, company: null, location: null, description: null };
    const result = evaluateRelevance(job);
    expect(result.tier).toBe("strong");
    expect(result.negativeRules).not.toContain("missing_company_and_location");
  });

  test("filters construction project management", () => {
    const job = { ...baseJob, title: "Project Manager – pozemní stavby" };
    const result = evaluateRelevance(job);
    expect(result.tier).toBe("filtered_out");
    expect(result.negativeRules).toContain("construction");
  });

  test("filters delivery roles that are actually software engineering", () => {
    const job = {
      ...baseJob,
      title: "Development Engineer / Delivery Manager – Development Core Team",
    };
    const result = evaluateRelevance(job);
    expect(result.tier).toBe("filtered_out");
    expect(result.negativeRules).toContain("software_development");
  });

  test("keeps an adjacent post-sale role", () => {
    const job = { ...baseJob, title: "Technical Account Manager" };
    expect(evaluateRelevance(job).tier).toBe("adjacent");
  });

  test("does not instant-alert when the location is unknown", () => {
    const job = { ...baseJob, location: null, remoteMode: "unknown" as const };
    const result = evaluateRelevance(job);
    expect(result.tier).toBe("strong");
    expect(result.negativeRules).toContain("location_unknown");
    expect(isStrictHighFit(job, result, new Date("2026-08-08T10:00:00.000Z"))).toBe(false);
  });

  test("creates the same fingerprint for cosmetic spelling differences", () => {
    const first = createFingerprint(baseJob);
    const second = createFingerprint({
      ...baseJob,
      title: " Customer  Success Manager ",
      company: "EXAMPLE SAAS, s.r.o.",
      location: "PRAHA",
      canonicalUrl: "https://another-source.test/job/99",
    });
    expect(first).toBe(second);
  });
});
