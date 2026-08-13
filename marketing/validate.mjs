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

  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (route === "/") {
    if (scripts.length !== 1 || !scripts[0][0].includes('src="/assets/story.js"') || scripts[0][1].trim() !== "") {
      throw new Error("Homepage may run only the external product-story enhancement.");
    }
  } else if (scripts.length > 0) {
    throw new Error(`${route} unexpectedly runs client-side script.`);
  }
}

const homepage = documents.get("/");
const homepageText = homepage.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const requiredHomepageCopy = [
  "Oops. You forgot to message them again.",
  "Keep in touch with the people you mean to.",
  "PeopleOS reminds you when it’s time, with something to say.",
  "Join the iPhone beta",
  "Set it once. PeopleOS remembers from there.",
  "Every 3 days",
  "Contacted today",
  "Today reminders · Settings",
  "Optional and off by default.",
  "Three days later",
  "People are waiting on your list today.",
  "Hi Dad, how have you been lately?",
  "Another suggestion",
  "Prepared, not sent. You choose Send.",
  "Keep in touch with the people you love.",
  "Mum",
  "Sister",
  "Grandad",
  "Best friend",
  "Professional, without the CRM.",
  "Simon",
  "Follow up Friday",
  "Sarah",
  "Check in next month",
  "James",
  "Remember the people you mean to keep in touch with."
];

for (const text of requiredHomepageCopy) {
  if (!homepageText.includes(text)) throw new Error(`Homepage is missing required copy: ${text}`);
}

for (const forbidden of [
  "last spoke",
  "you haven’t spoken",
  "AI-powered",
  "testimonial",
  "trusted by",
  "automatically sends",
  "sent for you",
  "generated from notes",
  "pipeline",
  "lead scoring",
  "sales stage"
]) {
  if (homepageText.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`Homepage contains forbidden claim: ${forbidden}`);
}

for (const moment of ["add", "cadence", "reminder", "today", "whatsapp"]) {
  if (!homepage.includes(`data-demo-frame="${moment}"`) || !homepage.includes(`data-demo-select="${moment}"`)) {
    throw new Error(`Homepage is missing the ${moment} product-story moment.`);
  }
}

if (homepage.includes("Time to catch up with Dad")) {
  throw new Error("The lock-screen reminder must not expose Dad's name.");
}

const stylesheet = await readFile(join(root, "assets/site.css"), "utf8");
if (!stylesheet.includes("prefers-reduced-motion")) {
  throw new Error("Marketing motion must respect prefers-reduced-motion.");
}

const story = await readFile(join(root, "assets/story.js"), "utf8");
if (!story.includes("prefers-reduced-motion") || !story.includes("setInterval") || !story.includes("anotherStarter")) {
  throw new Error("The product loop needs a reduced-motion-aware progressive enhancement.");
}

const marketingMark = await readFile(join(root, "assets/peopleos-mark.svg"), "utf8");
const canonicalMark = await readFile(join(root, "../public/peopleos-mark.svg"), "utf8");
if (marketingMark.trim() !== canonicalMark.trim()) {
  throw new Error("Marketing must use the canonical three-column PeopleOS mark.");
}
for (const [route, html] of documents) {
  if (!html.includes('src="/assets/peopleos-mark.svg"')) {
    throw new Error(`${route} is missing the canonical PeopleOS mark.`);
  }
}

if (!documents.get("/download").includes("public TestFlight link is not live yet")) {
  throw new Error("Download route must remain truthful until a TestFlight URL is supplied.");
}
if (!documents.get("/support").includes("monitored support email")) {
  throw new Error("Support route must preserve the missing-contact release blocker.");
}

console.log(`Marketing validation passed for ${routes.size} routes.`);
