import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = new URL("../", import.meta.url);
const appOutput = new URL("../dist-app/", import.meta.url);
const productionOutput = new URL("../dist/", import.meta.url);
const marketingSource = new URL("../marketing/", import.meta.url);

await rm(productionOutput, { recursive: true, force: true });
await mkdir(productionOutput, { recursive: true });

for (const entry of ["index.html", "privacy", "support", "download", "assets"]) {
  await cp(new URL(entry, marketingSource), new URL(entry, productionOutput), { recursive: true });
}

await mkdir(new URL("app/", productionOutput), { recursive: true });
await cp(appOutput, new URL("app/", productionOutput), { recursive: true });

// A former production build registered /sw.js with scope /. This tiny endpoint
// replaces that worker, removes its old caches, and then unregisters itself.
// The current PWA worker is generated below /app and cannot control marketing.
const retirementWorker = `self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>!key.startsWith("peopleos-app-")).map(key=>caches.delete(key)));
  await self.clients.claim();
  await self.registration.unregister();
  const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of clients) client.postMessage({type:"PEOPLEOS_ROOT_SW_RETIRED"});
})()));
self.addEventListener("fetch",()=>{});
`;
await writeFile(new URL("sw.js", productionOutput), retirementWorker, "utf8");

const retirementClient = `(()=>{
  const migrationKey = "peopleos-root-pwa-retired-v1";
  const legacyStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches
    && window.location.pathname === "/";
  if (legacyStandalone && localStorage.getItem(migrationKey) === "done") {
    window.location.replace("/app");
    return;
  }
  if (!("serviceWorker" in navigator)) {
    if (legacyStandalone) {
      localStorage.setItem(migrationKey,"done");
      window.location.replace("/app");
    }
    return;
  }
  if (localStorage.getItem(migrationKey) === "done") return;
  navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(registration=>{
    registration.update().catch(()=>{});
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener("message",event=>{
    if (event.data?.type === "PEOPLEOS_ROOT_SW_RETIRED") {
      localStorage.setItem(migrationKey,"done");
      if (legacyStandalone) window.location.replace("/app");
    }
  });
  if (legacyStandalone && !navigator.serviceWorker.controller) {
    localStorage.setItem(migrationKey,"done");
    window.location.replace("/app");
  }
})();
`;
await writeFile(new URL("assets/retire-root-pwa.js", productionOutput), retirementClient, "utf8");

const marketingIndexUrl = new URL("index.html", productionOutput);
const marketingIndex = await readFile(marketingIndexUrl, "utf8");
const enhancedIndex = marketingIndex.replace(
  "</head>",
  "    <script src=\"/assets/retire-root-pwa.js\" defer></script>\n  </head>"
);
if (enhancedIndex === marketingIndex) throw new Error("Could not install the legacy PWA retirement client.");
await writeFile(marketingIndexUrl, enhancedIndex, "utf8");

const appIndex = await readFile(join(repositoryRoot.pathname, "dist", "app", "index.html"), "utf8");
if (!appIndex.includes("/app/assets/")) throw new Error("The web application was not built with the /app base path.");

console.log("Assembled marketing routes and the shared PeopleOS app into dist/.");
