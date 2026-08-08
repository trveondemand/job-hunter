import { describe, expect, test } from "bun:test";
import { companyKey } from "../src/normalize";
import { companyKey as edgeCompanyKey } from "../supabase/functions/_shared/company";

describe("company key", () => {
  test("strips legal forms so job boards match the monitored list", () => {
    expect(companyKey("MEWS SYSTEMS S.R.O.")).toBe("mews systems");
    expect(companyKey("Alza.cz a.s.")).toBe("alza cz");
    expect(companyKey("Rossum s.r.o.")).toBe(companyKey("Rossum"));
    expect(companyKey("Productboard, Inc.")).toBe("productboard");
  });

  test("keeps distinct companies distinct", () => {
    expect(companyKey("Make")).not.toBe(companyKey("Maker"));
    expect(companyKey("")).toBe("");
  });

  test("edge function copy stays in sync with src/normalize", () => {
    const samples = [
      "MEWS SYSTEMS S.R.O.",
      "Alza.cz a.s.",
      "Productboard, Inc.",
      "Rohlík Group",
      "Škoda Auto",
      "Better Stack GmbH",
      "",
      null,
    ];
    for (const sample of samples) {
      expect(edgeCompanyKey(sample)).toBe(companyKey(sample));
    }
  });
});
