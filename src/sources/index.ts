import type { JobSource, SourceName } from "../types";
import { datacruitSource } from "./datacruit";
import { jobsCzSource } from "./jobsCz";
import { joobleSource } from "./jooble";
import { startupJobsSource } from "./startupjobs";

export const sources: Record<SourceName, JobSource> = {
  startupjobs: startupJobsSource,
  jooble: joobleSource,
  jobs_cz: jobsCzSource,
  datacruit: datacruitSource,
};
