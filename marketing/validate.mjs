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
    const approvedSources = ["/assets/story.js", "/assets/waitlist.js"];
    const scriptSources = scripts.map((script) => script[0].match(/\bsrc="([^"]+)"/i)?.[1]);
    if (scripts.length !== approvedSources.length || scripts.some((script) => script[1].trim() !== "")) {
      throw new Error("Homepage may run only its approved local external scripts.");
    }
    if (approvedSources.some((source) => !scriptSources.includes(source))) {
      throw new Error("Homepage is missing an approved local script.");
    }
    if (!scripts.some((script) => /type="module"/i.test(script[0]) && /src="\/assets\/waitlist\.js"/i.test(script[0]))) {
      throw new Error("Homepage waitlist controller must load as an ES module.");
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
  "Join the iPhone beta waitlist",
  "Email address",
  "First name (optional)",
  "We’ll only use your email for PeopleOS beta and launch updates.",
  "We won’t add you to broader marketing unless you choose that separately.",
  "You’re on the list.",
  "We’ll let you know when the PeopleOS iPhone beta is ready.",
  "One quick question before you go: who are you worst at keeping in touch with?",
  "Family",
  "Friends",
  "Professional contacts",
  "Honestly, everyone",
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

const waitlistCtaCount = homepageText.match(/Join the iPhone beta waitlist/g)?.length || 0;
if (waitlistCtaCount !== 3) {
  throw new Error(`Homepage must have exactly three primary waitlist CTAs, found ${waitlistCtaCount}.`);
}

if ((homepage.match(/data-waitlist-root/g) || []).length !== 2
  || (homepage.match(/data-waitlist-form/g) || []).length !== 2) {
  throw new Error("Homepage must contain synchronized waitlist forms in the hero and final CTA.");
}

if ((homepage.match(/name="email"/g) || []).length !== 2
  || (homepage.match(/name="first_name"/g) || []).length !== 2
  || (homepage.match(/name="_gotcha"/g) || []).length !== 2) {
  throw new Error("Both waitlist forms need email, optional first-name and honeypot fields.");
}

if (homepage.includes('action="https://formspree.io')) {
  throw new Error("Waitlist submissions must stay behind the local adapter and inline success state.");
}

for (const answer of ["family", "friends", "professional", "everyone"]) {
  if ((homepage.match(new RegExp(`data-waitlist-answer="${answer}"`, "g")) || []).length !== 2) {
    throw new Error(`Both waitlist success states must include the ${answer} answer.`);
  }
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

if (!stylesheet.includes(".waitlist-panel") || !stylesheet.includes(".waitlist-answers")) {
  throw new Error("Marketing styles must include the waitlist form and optional-answer states.");
}

const story = await readFile(join(root, "assets/story.js"), "utf8");
if (!story.includes("prefers-reduced-motion") || !story.includes("setInterval") || !story.includes("anotherStarter")) {
  throw new Error("The product loop needs a reduced-motion-aware progressive enhancement.");
}


const waitlistController = await readFile(join(root, "assets/waitlist.js"), "utf8");
const waitlistProvider = await readFile(join(root, "assets/waitlist-provider.js"), "utf8");
if (!waitlistController.includes('from "./waitlist-provider.js"')
  || !waitlistController.includes("provider.join")
  || !waitlistController.includes("provider.answer")) {
  throw new Error("Waitlist behaviour must use the replaceable provider adapter.");
}
if ((waitlistProvider.match(/https:\/\/formspree\.io\/f\//g) || []).length !== 1
  || !waitlistProvider.includes("consent_scope")
  || !waitlistProvider.includes("correlation_id")) {
  throw new Error("The waitlist adapter must preserve the Formspree, consent and correlation contracts.");
}
if (/api[_-]?key|secret|bearer\s/i.test(waitlistProvider)) {
  throw new Error("The browser waitlist adapter must not contain provider credentials.");
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
if (!documents.get("/download").includes('href="/#waitlist">Join the iPhone beta waitlist</a>')) {
  throw new Error("Download route must lead to the current waitlist conversion goal.");
}
if (!documents.get("/support").includes("monitored support email")) {
  throw new Error("Support route must preserve the missing-contact release blocker.");
}

if (!documents.get("/privacy").includes("Formspree")
  || !documents.get("/privacy").includes("beta and launch updates")) {
  throw new Error("Privacy policy must disclose waitlist processing and its limited purpose.");
}

for (const route of ["/privacy", "/support"]) {
  if (!documents.get(route).includes('href="/#waitlist">Join the iPhone beta waitlist</a>')) {
    throw new Error(`${route} must point its primary CTA to the homepage waitlist.`);
  }
}

const vercelConfig = await readFile(join(root, "../vercel.json"), "utf8");
if (!vercelConfig.includes("connect-src 'self' https://formspree.io")) {
  throw new Error("Vercel CSP must narrowly allow waitlist submissions to Formspree.");
}

console.log(`Marketing validation passed for ${routes.size} routes.`);
