import { execFileSync } from "node:child_process";
const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim()
  || process.env.PEOPLEOS_DEPLOY_BRANCH?.trim();
const commit = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  || process.env.PEOPLEOS_DEPLOY_COMMIT?.trim();
const environment = process.env.VERCEL_ENV;

if (environment === "production") {
  if (branch !== "main") {
    throw new Error(`Production Vercel builds require declared main provenance, received ${branch || "none"}.`);
  }
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("Production Vercel builds require an exact 40-character Git commit.");
  }
}

execFileSync("npm", ["run", "build"], { stdio: "inherit" });
