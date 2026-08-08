import { describe, expect, test } from "bun:test";
import { extractDatacruitDetail } from "../src/sources/datacruit";
import { extractJobsCzDetail } from "../src/sources/jobsCz";

const jobsCzPage = (title: string, location: string) => `
<html><head><meta property="og:title" content="${title}"></head>
<body><span data-test="jd-info-location">  ${location}  </span></body></html>`;

const datacruitPage = (title: string) =>
  `<html><head><meta property="og:title" content="${title}"></head><body></body></html>`;

describe("jobs.cz detail parsing", () => {
  test("reads the employer from the title and the location from the info block", () => {
    expect(
      extractJobsCzDetail(
        jobsCzPage(
          "Senior projektový manažer úseku výstavby (m/ž) – Lidl Česká republika s.r.o.",
          "Siemensova 2717/4, Praha – Stodůlky",
        ),
      ),
    ).toEqual({
      company: "Lidl Česká republika s.r.o.",
      location: "Siemensova 2717/4, Praha – Stodůlky",
    });
  });

  test("takes the last segment when the position itself contains a dash", () => {
    expect(
      extractJobsCzDetail(
        jobsCzPage("Projektový manažer – Brand Activation – MAXIN PRAGUE s.r.o.", "Praha"),
      ).company,
    ).toBe("MAXIN PRAGUE s.r.o.");
  });

  test("ignores a trailing fragment that is only punctuation", () => {
    expect(extractJobsCzDetail(jobsCzPage("Projektový manažer – ,", "Praha")).company).toBeNull();
  });

  test("falls back to the page title on the template with a bare share title", () => {
    const page = `<html><head><meta property="og:title" content="Senior IT projektový manažer">
      <title>Detail pozice | PPF a.s.</title></head>
      <body><span data-test="jd-info-location">Praha 8</span></body></html>`;
    expect(extractJobsCzDetail(page)).toEqual({ company: "PPF a.s.", location: "Praha 8" });
  });

  test("does not mistake a pipe inside the position for an employer", () => {
    const page = `<html><head>
      <meta property="og:title" content="Projektový manažer | AV a elektro technologie">
      <title>Detail pozice | Grafton.cz</title></head><body></body></html>`;
    expect(extractJobsCzDetail(page).company).toBe("Grafton.cz");
  });

  test("leaves the company empty when the title has no employer", () => {
    expect(extractJobsCzDetail(jobsCzPage("Projektový manažer", "Praha"))).toEqual({
      company: null,
      location: "Praha",
    });
  });
});

describe("datacruit detail parsing", () => {
  test("reads the location from the title", () => {
    expect(extractDatacruitDetail(datacruitPage("Customer Care with German - Prague"))).toEqual({
      location: "Prague",
    });
    expect(
      extractDatacruitDetail(
        datacruitPage("Projektový manažer pro strojní oblast (M/Ž) - Praha hl.m."),
      ),
    ).toEqual({ location: "Praha hl.m." });
  });

  test("returns nothing when the title carries no location", () => {
    expect(extractDatacruitDetail(datacruitPage("Projektový manažer"))).toEqual({ location: null });
  });
});
