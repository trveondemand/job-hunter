import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractJsonLdJob } from "../src/parsers";
import { extractJobLinks } from "../src/sources/shared";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

describe("job page parsing", () => {
  test("extracts a normalized JobPosting object", () => {
    const job = extractJsonLdJob(fixture("job-detail.html"), "https://fallback.test/job");
    expect(job).toEqual({
      title: "Customer Success Manager",
      company: "Example SaaS",
      location: "Praha, CZ",
      remoteMode: "hybrid",
      description: "Own onboarding and customer adoption in a hybrid team.",
      canonicalUrl: "https://example.test/jobs/42",
      publishedAt: "2026-08-08T04:00:00.000Z",
    });
  });
});

describe("listing page parsing", () => {
  test("extracts stable Jobs.cz IDs without relying on CSS classes", () => {
    const jobs = extractJobLinks(fixture("listings.html"), {
      source: "jobs_cz",
      baseUrl: "https://www.jobs.cz",
      pattern: /^\/rpd\/(\d+)\/?$/,
    });
    expect(jobs.map((job) => [job.sourceId, job.title])).toEqual([
      ["200001", "Customer Success Manager"],
      ["200002", "Implementation Lead"],
    ]);
  });

  test("extracts Datacruit IDs from slugs", () => {
    const jobs = extractJobLinks(fixture("listings.html"), {
      source: "datacruit",
      baseUrl: "https://jobs.datacruit.com",
      pattern: /^\/pozice\/.+-(\d+)\/?$/,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceId).toBe("310001");
  });
});
