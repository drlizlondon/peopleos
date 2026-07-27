/**
 * Minimal ambient declarations for the Node APIs the performance harness uses.
 *
 * Deliberately not `@types/node`. PeopleOS is a browser application, and adding
 * the full Node type surface would put `process`, `Buffer` and friends into the
 * global scope of every file — including the domain and UI layers, where
 * reaching for them is a mistake the compiler should catch. The harness is the
 * only code here that legitimately touches the filesystem, so it declares
 * exactly what it needs and nothing more.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}
