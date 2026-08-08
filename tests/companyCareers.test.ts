import { describe, expect, test } from "bun:test";
import { isPublicIpAddress, normalizeCareerUrl } from "../src/sources/careerUrl";
import {
  detectCareerAdapter,
  extractGenericJobUrls,
  parseAshbyJobs,
  parseGreenhouseJobs,
  parseLeverJobs,
} from "../src/sources/companyCareers";
import {
  nextCompanyFailureState,
  shouldCloseMissingCompanyJob,
} from "../src/sources/companyLifecycle";
import type { MonitoredCompany } from "../src/types";

const company: MonitoredCompany = {
  id: "10000000-0000-0000-0000-000000000001",
  name: "Example SaaS",
  careersUrl: "https://example.test/careers",
  enabled: true,
  detectedAdapter: null,
  adapterKey: null,
  lastCheckedAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  lastError: null,
};

describe("career adapter detection", () => {
  test("detects supported hosted boards and embedded Greenhouse forms", () => {
    expect(detectCareerAdapter("https://jobs.ashbyhq.com/apify/abc")).toEqual({
      adapter: "ashby",
      key: "apify",
    });
    expect(detectCareerAdapter("https://jobs.lever.co/keyloop/abc")).toEqual({
      adapter: "lever",
      key: "keyloop",
    });
    expect(
      detectCareerAdapter("https://job-boards.greenhouse.io/embed/job_app?for=make&token=42"),
    ).toEqual({ adapter: "greenhouse", key: "make" });
  });
});

describe("structured ATS mapping", () => {
  test("maps Ashby jobs into normalized discovery records", () => {
    const records = parseAshbyJobs(
      {
        jobs: [
          {
            id: "ashby-1",
            title: "Customer Success Manager",
            location: "Prague",
            workplaceType: "Hybrid",
            descriptionPlain: "Own customer onboarding.",
            jobUrl: "https://jobs.ashbyhq.com/example/ashby-1",
            publishedAt: "2026-08-08T06:00:00Z",
            isListed: true,
          },
        ],
      },
      company,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "company_careers",
      companyId: company.id,
      title: "Customer Success Manager",
      company: "Example SaaS",
      location: "Prague",
    });
    expect(
      parseAshbyJobs(
        {
          jobs: [
            {
              id: "ashby-1",
              title: "Customer Success Manager",
              jobUrl: "https://jobs.ashbyhq.com/example/ashby-1",
            },
          ],
        },
        company,
      )[0].sourceId,
    ).toBe(records[0].sourceId);
  });

  test("maps Greenhouse and Lever descriptions and locations", () => {
    const greenhouse = parseGreenhouseJobs(
      {
        jobs: [
          {
            id: 42,
            title: "Implementation Manager",
            absolute_url: "https://boards.greenhouse.io/example/jobs/42",
            location: { name: "Prague, Czechia" },
            content: "&lt;p&gt;Lead enterprise implementations.&lt;/p&gt;",
            first_published: "2026-08-08T06:00:00Z",
          },
        ],
      },
      company,
    );
    const lever = parseLeverJobs(
      [
        {
          id: "lever-1",
          text: "Delivery Manager",
          hostedUrl: "https://jobs.lever.co/example/lever-1",
          categories: { location: "Prague", allLocations: ["Prague", "Remote"] },
          workplaceType: "hybrid",
          descriptionPlain: "Deliver customer projects.",
          createdAt: Date.parse("2026-08-08T06:00:00Z"),
        },
      ],
      company,
    );
    expect(greenhouse[0].snippet).toBe("Lead enterprise implementations.");
    expect(lever[0]).toMatchObject({ title: "Delivery Manager", location: "Prague, Remote" });
  });

  test("rejects malformed provider payloads", () => {
    expect(() => parseAshbyJobs({}, company)).toThrow("Ashby response");
    expect(() => parseGreenhouseJobs([], company)).toThrow("Greenhouse response");
    expect(() => parseLeverJobs({}, company)).toThrow("Lever response");
  });
});

describe("company crawler lifecycle", () => {
  test("disables only block and rate-limit failures after the third occurrence", () => {
    expect(nextCompanyFailureState(1, true, true)).toEqual({
      consecutiveFailures: 2,
      enabled: true,
    });
    expect(nextCompanyFailureState(2, true, true)).toEqual({
      consecutiveFailures: 3,
      enabled: false,
    });
    expect(nextCompanyFailureState(8, false, false)).toEqual({
      consecutiveFailures: 9,
      enabled: true,
    });
    expect(nextCompanyFailureState(8, true, false)).toEqual({
      consecutiveFailures: 1,
      enabled: true,
    });
  });

  test("closes missing structured jobs immediately and generic jobs only after confirmation", () => {
    expect(shouldCloseMissingCompanyJob("ashby")).toBe(true);
    expect(shouldCloseMissingCompanyJob("greenhouse")).toBe(true);
    expect(shouldCloseMissingCompanyJob("lever")).toBe(true);
    expect(shouldCloseMissingCompanyJob("generic", true)).toBe(false);
    expect(shouldCloseMissingCompanyJob("generic", false)).toBe(true);
  });
});

describe("generic career fallback", () => {
  test("keeps only same-origin job-shaped detail links", () => {
    const urls = extractGenericJobUrls(
      `
        <a href="/careers/customer-success-manager">Customer Success Manager</a>
        <a href="https://example.test/pozice/implementation-lead/">Implementation Lead</a>
        <a href="https://other.test/jobs/not-ours">Other company</a>
        <a href="/about">About</a>
      `,
      "https://example.test/careers",
    );
    expect(urls).toEqual([
      "https://example.test/careers/customer-success-manager",
      "https://example.test/pozice/implementation-lead",
    ]);
  });
});

describe("career URL safety", () => {
  test("normalizes safe HTTPS URLs", () => {
    expect(normalizeCareerUrl(" https://Example.COM/careers/#jobs ")).toBe(
      "https://example.com/careers",
    );
  });

  test("rejects unsafe protocols and identifies private addresses", () => {
    expect(() => normalizeCareerUrl("http://example.com/jobs")).toThrow("HTTPS");
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
  });
});
