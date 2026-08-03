import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REQUIRED_NODE_MAJOR = 22;
const nodeMajor = Number(process.versions.node.split(".")[0]);

if (nodeMajor !== REQUIRED_NODE_MAJOR) {
  console.error(
    `[ratchet] Node ${REQUIRED_NODE_MAJOR} is required because the recorded performance baseline and CI use Node ${REQUIRED_NODE_MAJOR}. `
    + `Current runtime: ${process.versions.node}.`
  );
  process.exit(1);
}

const vitest = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
const files = [
  "src/performance/alreadyContacted.perf.test.ts",
  "src/performance/peopleList.perf.test.ts",
  "src/performance/search.perf.test.ts",
  "src/performance/searchSingle.perf.test.ts",
  "src/performance/today.perf.test.ts"
];

for (const file of files) {
  console.log(`[ratchet] isolated file: ${file}`);
  const result = spawnSync(process.execPath, [vitest, "run", file], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
