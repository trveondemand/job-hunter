import { createHash } from "node:crypto";
import { normalize } from "./normalize";
import type { NormalizedJob, RelevanceResult } from "./types";

export { normalize };

const strongRules: Array<[string, RegExp]> = [
  ["customer_success", /\bcustomer success\b/],
  ["customer_onboarding", /\b(customer |client )?onboarding\b/],
  ["implementation", /\bimplementation (manager|consultant|lead|specialist)\b|\bimplementac/],
  [
    "project_program_delivery",
    /\b(project|program|delivery) (manager|lead|consultant)\b|\bprojektov[yai] manazer/,
  ],
];

const adjacentRules: Array<[string, RegExp]> = [
  ["professional_services", /\bprofessional services\b/],
  ["solutions_consulting", /\bsolutions? consultant\b/],
  ["technical_account", /\btechnical account manager\b/],
  ["client_services", /\b(client|customer) services?\b/],
  ["partner_success", /\bpartner success\b/],
  ["adoption_enablement", /\b(adoption|enablement) (manager|lead|consultant|specialist)\b/],
  ["customer_operations", /\bcustomer (operations|experience|journey)\b/],
  ["service_management", /\bservice (delivery|manager|management)\b/],
  ["post_sale_account", /\b(account|relationship) manager\b/],
];

const exploreRules: Array<[string, RegExp]> = [
  [
    "exploration_role",
    /\b(customer|client|service|lifecycle|change|gtm|adoption|enablement).{0,32}\b(manager|lead|consultant|operations|specialist|architect)\b/,
  ],
  ["customer_care", /\b(customer care|pece o zakaznik|zakaznicka pece)\b/],
];

const hardNegativeRules: Array<[string, RegExp]> = [
  ["internship", /\b(intern|internship|staz|trainee)\b/],
  ["call_center", /\b(call ?cent(er|rum)|operator zakaznicke linky|telemarketing)\b/],
  ["retail_or_warehouse", /\b(prodavac|pokladni|skladnik|warehouse|retail assistant)\b/],
  [
    "construction",
    /\b(stavby|stavebnictvi|stavbyvedouci|pozemni stavby|construction|facility manager)\b/,
  ],
  [
    "software_development",
    /\b(software|frontend|backend|full ?stack|java|\.net|development) (developer|engineer)\b|\b(development core team|engineering manager|vyvojar)\b/,
  ],
  ["acquisition_sales", /\b(sales hunter|business development representative|door to door)\b/],
];

const descriptionNegativeRules: Array<[string, RegExp]> = [
  ["call_center", /\b(call ?cent(er|rum)|operator zakaznicke linky|telemarketing)\b/],
  ["retail_or_warehouse", /\b(prodejna|pokladna|sklad|warehouse shift)\b/],
  ["construction", /\b(stavebnictvi|pozemni stavby|construction site)\b/],
];

function matches(rules: Array<[string, RegExp]>, value: string): string[] {
  return rules.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

function locationState(job: NormalizedJob): { confirmed: boolean; unacceptable: boolean } {
  const location = normalize(job.location);
  const description = normalize(job.description);
  const remoteCz =
    job.remoteMode === "remote" &&
    (/\b(cz|czech|cesk)\b/.test(`${location} ${description}`) ||
      !/\b(us|usa|uk only)\b/.test(location));
  const prague = /\b(praha|prague|hlavni mesto praha)\b/.test(location);

  if (prague || remoteCz) return { confirmed: true, unacceptable: false };
  if (!location) return { confirmed: false, unacceptable: false };
  if (job.remoteMode === "hybrid" && !prague) return { confirmed: false, unacceptable: true };
  if (job.remoteMode === "onsite" && !prague) return { confirmed: false, unacceptable: true };
  return { confirmed: false, unacceptable: false };
}

export function evaluateRelevance(job: NormalizedJob): RelevanceResult {
  const title = normalize(job.title);
  const searchable = `${title} ${normalize(job.description)}`;
  const negativeRules = [
    ...matches(hardNegativeRules, title),
    ...matches(descriptionNegativeRules, normalize(job.description)),
  ].filter((rule, index, values) => values.indexOf(rule) === index);
  const location = locationState(job);

  if (location.unacceptable) negativeRules.push("location_outside_prague");
  if (!location.confirmed && !location.unacceptable) negativeRules.push("location_unknown");

  const hardNegative = negativeRules.some((rule) => rule !== "location_unknown");
  const strong = matches(strongRules, title);
  const adjacent = matches(adjacentRules, searchable);
  const explore = matches(exploreRules, searchable);

  if (hardNegative) {
    return {
      tier: "filtered_out",
      matchedRules: [...strong, ...adjacent, ...explore],
      negativeRules,
      locationConfirmed: false,
    };
  }
  if (strong.length > 0) {
    return {
      tier: "strong",
      matchedRules: strong,
      negativeRules,
      locationConfirmed: location.confirmed,
    };
  }
  if (adjacent.length > 0) {
    return {
      tier: "adjacent",
      matchedRules: adjacent,
      negativeRules,
      locationConfirmed: location.confirmed,
    };
  }
  if (explore.length > 0) {
    return {
      tier: "explore",
      matchedRules: explore,
      negativeRules,
      locationConfirmed: location.confirmed,
    };
  }
  return {
    tier: "filtered_out",
    matchedRules: [],
    negativeRules: [...negativeRules, "no_relevant_role_signal"],
    locationConfirmed: location.confirmed,
  };
}

export function createFingerprint(job: NormalizedJob): string {
  const company = normalize(job.company);
  const basis = company
    ? `${normalize(job.title)}|${company}|${normalize(job.location)}`
    : `${normalize(job.title)}|${new URL(job.canonicalUrl).hostname}|${normalize(job.location)}`;
  return createHash("sha256").update(basis).digest("hex");
}

export function isStrictHighFit(
  job: NormalizedJob,
  result: RelevanceResult,
  now = new Date(),
): boolean {
  if (result.tier !== "strong" || !result.locationConfirmed || result.negativeRules.length > 0) {
    return false;
  }
  if (!job.publishedAt) return false;
  const age = now.getTime() - new Date(job.publishedAt).getTime();
  return age >= 0 && age <= 24 * 60 * 60 * 1_000;
}
