import { execFileSync } from "node:child_process";
import { assertProductionSource } from "./assert-production-source.mjs";

const head = assertProductionSource();

console.log(`Deploying PeopleOS production from main ${head.slice(0, 12)}.`);
execFileSync("npx", [
  "vercel",
  "--prod",
  "--yes",
  "--archive=tgz",
  "--build-env", "PEOPLEOS_DEPLOY_BRANCH=main",
  "--build-env", `PEOPLEOS_DEPLOY_COMMIT=${head}`,
  "--meta", "peopleosBranch=main",
  "--meta", `peopleosCommit=${head}`
], { stdio: "inherit" });
