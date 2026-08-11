import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function text(path) {
  return readFile(join(repositoryRoot, path), "utf8");
}

async function filesBelow(root, current = root) {
  const entries = await readdir(join(repositoryRoot, current), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, path));
    else if (entry.isFile()) files.push(relative(root, path));
  }
  return files.sort();
}

async function digest(path) {
  return createHash("sha256").update(await readFile(join(repositoryRoot, path))).digest("hex");
}

function uniqueMatches(source, expression) {
  return [...new Set([...source.matchAll(expression)].map((match) => match[1]))];
}

const packageJson = JSON.parse(await text("package.json"));
const project = await text("ios/App/App.xcodeproj/project.pbxproj");
const infoPlist = await text("ios/App/App/Info.plist");
const entitlements = await text("ios/App/App/App.entitlements");
const nativePackage = await text("ios/App/CapApp-SPM/Package.swift");

const marketingVersions = uniqueMatches(project, /MARKETING_VERSION = ([^;]+);/g);
if (marketingVersions.length !== 1 || marketingVersions[0] !== packageJson.version) {
  throw new Error(`Native marketing version (${marketingVersions.join(", ")}) must match package version ${packageJson.version}.`);
}

const buildNumbers = uniqueMatches(project, /CURRENT_PROJECT_VERSION = ([^;]+);/g);
if (buildNumbers.length !== 1 || !/^\d+$/.test(buildNumbers[0]) || Number(buildNumbers[0]) < 1) {
  throw new Error("Every native configuration must use the same positive integer build number.");
}

if (!/TARGETED_DEVICE_FAMILY = 1;/g.test(project)) throw new Error("The untested iPad target is still enabled.");
if (infoPlist.includes("NSContactsUsageDescription")) throw new Error("Unused Contacts permission copy must not ship.");
if (infoPlist.includes("UIInterfaceOrientationLandscape") || infoPlist.includes("UISupportedInterfaceOrientations~ipad")) {
  throw new Error("The iPhone-first MVP must not advertise untested orientations or iPad support.");
}
if (entitlements.includes("aps-environment")) throw new Error("Local reminders must not add a remote-push entitlement.");
if (!nativePackage.includes("CapacitorLocalNotifications")) throw new Error("The native local-notifications package is missing.");

const distFiles = await filesBelow("dist");
if (distFiles.length === 0) throw new Error("The production web build is empty.");
const nativeFiles = await filesBelow("ios/App/App/public");
const expectedNativeFiles = [...distFiles, "cordova.js", "cordova_plugins.js"].sort();
if (JSON.stringify(nativeFiles) !== JSON.stringify(expectedNativeFiles)) {
  throw new Error("The native web bundle file list does not exactly match the production build.");
}
for (const file of distFiles) {
  const [webDigest, nativeDigest] = await Promise.all([
    digest(join("dist", file)),
    digest(join("ios/App/App/public", file))
  ]);
  if (webDigest !== nativeDigest) throw new Error(`Native web asset is stale: ${file}`);
}

console.log(`Release preflight passed for PeopleOS ${packageJson.version} (${buildNumbers[0]}).`);
console.log(`Verified ${distFiles.length} production assets in the native bundle.`);
console.log("Portal checks remain: distribution signing, production CloudKit schema, App Store Connect agreements/listing and signed-iPhone reminder QA.");
