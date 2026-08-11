import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const routes = new Map([
  ["/", "index.html"],
  ["/privacy", "privacy/index.html"],
  ["/support", "support/index.html"],
  ["/download", "download/index.html"]
]);
const documents = new Map();

for (const [route, file] of routes) {
  const html = await readFile(join(root, file), "utf8");
  documents.set(route, html);
  if (!html.includes('<meta name="viewport"')) throw new Error(`${route} is missing its viewport declaration.`);
  if (!html.includes('href="/privacy"') || !html.includes('href="/support"') || !html.includes('href="/download"')) {
    throw new Error(`${route} is missing a required footer route.`);
  }
  if (/<script\b/i.test(html)) throw new Error(`${route} unexpectedly runs client-side script.`);
}

const homepage = documents.get("/");
const homepageText = homepage.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const requiredHomepageCopy = [
  "Remember the people you mean to keep in touch with.",
  "PeopleOS tells you who to contact today, and reminds you why.",
  "Join the iPhone beta",
  "Who should I contact today?",
  "See the people you meant to follow up with and why they matter today.",
  "Save the things you want to remember about someone.",
  "Keep track of the people you mean to contact.",
  "Find someone using their name or the context you remember.",
  "Personal + Professional · Today · Reminders · Notes · Search · Relationship history · Optional iCloud sync"
];

for (const text of requiredHomepageCopy) {
  if (!homepageText.includes(text)) throw new Error(`Homepage is missing required copy: ${text}`);
}

for (const forbidden of ["last spoke", "you haven’t spoken", "AI-powered", "testimonial", "trusted by"]) {
  if (homepageText.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`Homepage contains forbidden claim: ${forbidden}`);
}

if (!documents.get("/download").includes("public TestFlight link is not live yet")) {
  throw new Error("Download route must remain truthful until a TestFlight URL is supplied.");
}
if (!documents.get("/support").includes("monitored support email")) {
  throw new Error("Support route must preserve the missing-contact release blocker.");
}

console.log(`Marketing validation passed for ${routes.size} routes.`);
