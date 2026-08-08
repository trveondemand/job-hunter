import { describe, expect, test } from "bun:test";
import { isPublicIpAddress, normalizeCareerUrl } from "../src/sources/careerUrl";
import {
  detectCareerAdapter,
  detectWidgetAdapter,
  extractGenericJobUrls,
  findListingPages,
  parseAshbyJobs,
  parseGreenhouseJobs,
  parseLeverJobs,
  parseRecruiteeOffers,
  parseTeamioJobAds,
  selectJobLinkGroup,
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

  test("accepts European Greenhouse boards and Recruitee addresses", () => {
    expect(detectCareerAdapter("https://job-boards.eu.greenhouse.io/jetbrains/jobs/4881")).toEqual({
      adapter: "greenhouse",
      key: "jetbrains",
    });
    expect(detectCareerAdapter("https://dataddo.recruitee.com/o/backend-engineer")).toEqual({
      adapter: "recruitee",
      key: "dataddo",
    });
    expect(detectCareerAdapter("https://api.recruitee.com/c/64081/careers/offers")).toEqual({
      adapter: "recruitee",
      key: "64081",
    });
  });

  test("reads boards out of embedded widget configuration", () => {
    expect(
      detectWidgetAdapter(
        "<script>new window.RTWidget({companies:[64081],language:`en`})</script>",
      ),
    ).toEqual({ adapter: "recruitee", key: "64081" });
    expect(
      detectWidgetAdapter(
        '<script>window.__LMC_CAREER_WIDGET__ = {"apiKey":"secret","widgetId":"2a6e2060"};</script>',
      ),
    ).toEqual({ adapter: "teamio", key: "2a6e2060:secret" });
    expect(detectWidgetAdapter("<p>We are hiring</p>")).toBeNull();
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

  test("maps Recruitee offers and skips unpublished ones", () => {
    const records = parseRecruiteeOffers(
      {
        offers: [
          {
            id: 2635356,
            title: "Customer Success Manager",
            careers_url: "https://example.recruitee.com/o/customer-success-manager",
            location: "Prague, Czechia",
            city: "Prague",
            country: "Czechia",
            hybrid: true,
            status: "published",
            description: "<p>Own onboarding.</p>",
            requirements: "<p>Three years of experience.</p>",
            published_at: "2026-06-10 12:34:50 UTC",
          },
          { id: 2, title: "Draft role", careers_url: "https://x.test/o/2", status: "draft" },
        ],
      },
      company,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      title: "Customer Success Manager",
      location: "Prague, Czechia",
      snippet: "Own onboarding. Three years of experience.",
    });
    expect(records[0].publishedAt).toBe("2026-06-10T12:34:50.000Z");
  });

  test("maps Teamio job ads from every group onto the career page", () => {
    const records = parseTeamioJobAds(
      {
        data: {
          widget: {
            jobAdList: {
              groupedJobAds: {
                jobAds: [
                  {
                    id: "2001361461",
                    title: "Implementation Consultant",
                    validFrom: "2026-08-05T22:03:02+00:00",
                    teaser: "Roll out our platform.",
                    employer: { companyName: "Example s.r.o." },
                    locations: [{ city: "Praha", country: "Česká republika" }],
                  },
                ],
                groups: [{ jobAds: [{ id: "2001361462", title: "Project Manager" }] }],
              },
            },
          },
        },
      },
      company,
    );
    expect(records.map((record) => record.title)).toEqual([
      "Implementation Consultant",
      "Project Manager",
    ]);
    expect(records[0]).toMatchObject({
      url: "https://example.test/careers?detail=2001361461",
      company: "Example s.r.o.",
      location: "Praha, Česká republika",
    });
  });

  test("rejects malformed provider payloads", () => {
    expect(() => parseAshbyJobs({}, company)).toThrow("Ashby response");
    expect(() => parseGreenhouseJobs([], company)).toThrow("Greenhouse response");
    expect(() => parseLeverJobs({}, company)).toThrow("Lever response");
    expect(() => parseRecruiteeOffers({}, company)).toThrow("Recruitee response");
    expect(() => parseTeamioJobAds({}, company)).toThrow("Teamio response");
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

  test("drops links that sit among the openings without being one", () => {
    expect(
      extractGenericJobUrls(
        `
          <a href="/careers/customer-success-manager">Customer Success Manager</a>
          <a href="/careers/signup">Job alerts</a>
          <a href="/careers/referral">Refer a friend</a>
        `,
        "https://example.test/careers",
      ),
    ).toEqual(["https://example.test/careers/customer-success-manager"]);
  });

  test("takes the largest set of sibling openings and ignores lone links", () => {
    expect(
      selectJobLinkGroup([
        "https://example.test/careers/overview",
        "https://example.test/careers/open-positions/success-manager/a1",
        "https://example.test/careers/open-positions/delivery-lead/b2",
        "https://example.test/careers/open-positions/office-manager/c3",
      ]),
    ).toEqual([
      "https://example.test/careers/open-positions/success-manager/a1",
      "https://example.test/careers/open-positions/delivery-lead/b2",
      "https://example.test/careers/open-positions/office-manager/c3",
    ]);

    // Translations of the career page itself share a depth but no path prefix.
    expect(
      selectJobLinkGroup([
        "https://example.test/es/careers",
        "https://example.test/de/careers",
        "https://example.test/pt/careers",
      ]),
    ).toEqual([]);
    expect(selectJobLinkGroup(["https://example.test/careers/engineering"])).toEqual([]);
  });

  test("finds the sub-page a career landing page hands the openings to", () => {
    expect(
      findListingPages(
        `
          <a href="/company/careers/open-positions/">Open positions</a>
          <a href="/company/careers/">Careers</a>
          <a href="https://elsewhere.test/jobs">Partner jobs</a>
          <a href="/company/about">About</a>
        `,
        "https://example.test/company/careers/",
      ),
    ).toEqual(["https://example.test/company/careers/open-positions"]);
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
