import { execFileSync } from "node:child_process";

execFileSync("npm", ["run", "build:native"], { stdio: "inherit" });
execFileSync("npx", ["cap", "sync", "ios"], { stdio: "inherit" });
