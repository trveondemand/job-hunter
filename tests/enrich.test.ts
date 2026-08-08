import { describe, expect, test } from "bun:test";
import { isPortalBoilerplate, needsBasics, scoreHydrated } from "../src/enrich";
import { evaluateRelevance } from "../src/relevance";
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

  test("decides on the ungated verdict, or the gate would hide the very jobs worth paying for", () => {
    const bare = { ...job, company: null, location: null };
    expect(evaluateRelevance(bare, { requireIdentity: true }).tier).toBe("filtered_out");
    expect(needsBasics(bare, evaluateRelevance(bare), "jobs_cz")).toBe(true);
  });
});

describe("portal boilerplate", () => {
  // On client-rendered postings the only address in the markup is the job
  // board's own, which is how jobs.cz's operator ended up stored as both an
  // employer and a location.
  test("recognises the operator behind jobs.cz", () => {
    expect(isPortalBoilerplate("Alma Career Czechia s.r.o.")).toBe(true);
    expect(isPortalBoilerplate("Praha 8, Libeň, Menclova 2538/2, 180 00")).toBe(true);
  });

  test("leaves real employers and places alone", () => {
    expect(isPortalBoilerplate("PPF a.s.")).toBe(false);
    expect(isPortalBoilerplate("Bühler Praha s.r.o.")).toBe(false);
    expect(isPortalBoilerplate("Ocelářská 392/9, Praha – Libeň")).toBe(false);
  });
});

describe("scoring a hydrated job", () => {
  test("still applies the gate when nothing could be recovered", async () => {
    const bare = { ...job, company: null, location: null };
    const scored = await scoreHydrated(bare, "jobs_cz");
    expect(scored.relevance.tier).toBe("filtered_out");
    expect(scored.relevance.negativeRules).toContain("missing_company");
  });

  test("keeps a complete job untouched", async () => {
    const scored = await scoreHydrated(job, "jobs_cz");
    expect(scored.job).toBe(job);
    expect(scored.relevance.tier).toBe("strong");
  });
});
