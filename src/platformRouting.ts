import { Capacitor } from "@capacitor/core";

export const WEB_APP_BASE_PATH = "/app";

export function isNativeApplication(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Product routes stay platform-neutral inside the application. The browser
 * publishes them under /app; Capacitor serves the same routes from its root.
 */
export function applicationBasePath(native?: boolean): string {
  if (native === true || (native === undefined && isNativeApplication())) return "";
  if (native === false) return WEB_APP_BASE_PATH;
  // Most existing UI tests exercise logical routes at /. A focused /app suite
  // exercises the published browser base without forcing unrelated tests to
  // encode hosting details. Production web builds always use /app.
  if (import.meta.env.MODE === "test" && !globalThis.location?.pathname.startsWith(WEB_APP_BASE_PATH)) return "";
  return WEB_APP_BASE_PATH;
}

export function logicalPathFromBrowserPath(
  pathname: string,
  native?: boolean
): string {
  const base = applicationBasePath(native);
  if (!base) return normalizeLogicalPath(pathname);
  if (pathname === WEB_APP_BASE_PATH || pathname === `${WEB_APP_BASE_PATH}/`) return "/";
  if (pathname.startsWith(`${WEB_APP_BASE_PATH}/`)) {
    return normalizeLogicalPath(pathname.slice(WEB_APP_BASE_PATH.length));
  }
  return normalizeLogicalPath(pathname);
}

export function browserPathForLogicalPath(
  logicalPath: string,
  native?: boolean
): string {
  const normalized = normalizeLogicalPath(logicalPath);
  if (!applicationBasePath(native)) return normalized;
  return normalized === "/" ? WEB_APP_BASE_PATH : `${WEB_APP_BASE_PATH}${normalized}`;
}

export function appAssetPath(asset: string, native?: boolean): string {
  const cleanAsset = asset.replace(/^\/+/, "");
  const base = applicationBasePath(native);
  return `${base}/${cleanAsset}`;
}

function normalizeLogicalPath(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || "/";
  if (!withoutQuery.startsWith("/")) return `/${withoutQuery}`;
  return withoutQuery || "/";
}
