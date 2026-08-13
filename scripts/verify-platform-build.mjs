import { access, readFile } from "node:fs/promises";

const required = [
  "dist/index.html",
  "dist/privacy/index.html",
  "dist/support/index.html",
  "dist/download/index.html",
  "dist/app/index.html",
  "dist/app/manifest.webmanifest",
  "dist/app/sw.js",
  "dist/sw.js"
];

for (const path of required) await access(path);

const [marketing, app, manifest, rootWorker] = await Promise.all([
  readFile("dist/index.html", "utf8"),
  readFile("dist/app/index.html", "utf8"),
  readFile("dist/app/manifest.webmanifest", "utf8"),
  readFile("dist/sw.js", "utf8")
]);
const retirementClient = await readFile("dist/assets/retire-root-pwa.js", "utf8");
const appRegistration = await readFile("dist/app/registerSW.js", "utf8");
const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8"));

if (!marketing.includes("Oops. You forgot to message them again.")) throw new Error("Marketing root is missing.");
if (marketing.includes('id="root"')) throw new Error("Marketing root unexpectedly contains the product shell.");
if (!app.includes('id="root"') || !app.includes("/app/assets/")) throw new Error("The /app product entry is invalid.");
const parsedManifest = JSON.parse(manifest);
if (parsedManifest.id !== "/app" || parsedManifest.start_url !== "/app" || parsedManifest.scope !== "/app") {
  throw new Error("The PWA manifest must start at and remain below canonical /app.");
}
if (!appRegistration.includes("navigator.serviceWorker.register('/app/sw.js'")
  || !appRegistration.includes("scope: '/app'")) {
  throw new Error("The application worker must control canonical /app and its descendants.");
}
const workerScopeHeader = vercelConfig.headers?.find((entry) => entry.source === "/app/sw.js")
  ?.headers?.find((header) => header.key === "Service-Worker-Allowed")?.value;
if (workerScopeHeader !== "/app") {
  throw new Error("The /app worker must be allowed to control canonical /app itself.");
}
const appRewrites = vercelConfig.rewrites?.filter((entry) => entry.source === "/app" || entry.source === "/app/:path*");
if (appRewrites?.length !== 2 || appRewrites.some((entry) => entry.destination !== "/app/index")) {
  throw new Error("Clean-URL app routes must rewrite to the extensionless /app/index entry.");
}
if (!rootWorker.includes("registration.unregister")) throw new Error("The legacy root worker is not retired.");
if (!retirementClient.includes("peopleos-root-pwa-retired-v1") || !retirementClient.includes("localStorage.getItem")) {
  throw new Error("Legacy root-worker retirement must be a one-time migration.");
}
if (!retirementClient.includes('legacyStandalone && localStorage.getItem(migrationKey) === "done"')
  || !retirementClient.includes('window.location.replace("/app")')) {
  throw new Error("A previously retired root PWA must still launch the product at /app.");
}

console.log("Verified marketing, /app PWA scope, and legacy root-worker retirement.");
