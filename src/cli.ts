import { crawlSources } from "./crawler";
import { buildAndDeliverDigest } from "./digest";
import { type CrawlMode, SOURCE_NAMES, type SourceName } from "./types";

function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const command = process.argv[2];

if (command === "crawl") {
  const requested = flag("source") ?? "all";
  const names: SourceName[] =
    requested === "all"
      ? [...SOURCE_NAMES]
      : requested
          .split(",")
          .map((name) => name.trim())
          .filter((name): name is SourceName => SOURCE_NAMES.includes(name as SourceName));
  if (names.length === 0) throw new Error(`Unknown source: ${requested}`);
  const mode = (flag("mode") ?? "targeted") as CrawlMode;
  if (!(["targeted", "full"] as const).includes(mode))
    throw new Error(`Unknown crawl mode: ${mode}`);
  await crawlSources(names, { dryRun: hasFlag("dry-run"), force: hasFlag("force"), mode });
} else if (command === "digest") {
  await buildAndDeliverDigest(hasFlag("dry-run"));
} else {
  console.error(
    "Usage:\n  bun src/cli.ts crawl [--source all|startupjobs|jooble|jobs_cz|datacruit|company_careers] [--mode targeted|full] [--dry-run] [--force]\n  bun src/cli.ts digest [--dry-run]",
  );
  process.exitCode = 1;
}
