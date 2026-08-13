import { execFileSync } from "node:child_process";

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options }).trim();
}

export function assertProductionSource({ fetch = true } = {}) {
  const branch = git(["branch", "--show-current"]);
  if (branch !== "main") throw new Error(`Production deploys require main, received ${branch || "detached HEAD"}.`);
  if (git(["status", "--porcelain", "--untracked-files=normal"])) {
    throw new Error("Production deploys require a clean working tree.");
  }
  if (fetch) execFileSync("git", ["fetch", "origin", "main"], { stdio: "inherit" });
  const head = git(["rev-parse", "HEAD"]);
  let originMain;
  try {
    originMain = git(["rev-parse", "origin/main"]);
  } catch {
    throw new Error("origin/main is unavailable. Fetch before deploying production.");
  }
  if (head !== originMain) throw new Error("Production HEAD must exactly match origin/main.");
  return head;
}
