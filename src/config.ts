// Public application bootstrap; no embedded Miso login keys or chain SDK dependency.
import { z } from "zod";

export const publicConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  network: z.enum(["mainnet", "testnet"]),
  identityId: z.string().regex(/^miso-(mainnet|testnet)-v1$/),
  auth: z.strictObject({
    provider: z.literal("enoki"),
    google: z.strictObject({
      issuer: z.literal("https://accounts.google.com"),
      clientId: z.string().regex(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/),
    }),
    enoki: z.strictObject({ publicKey: z.string().regex(/^enoki_public_[a-f0-9]{32}$/) }),
  }),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type PublicConfigNetwork = PublicConfig["network"];
export const PUBLIC_CONFIG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export type PublicConfigStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface PublicConfigOptions {
  baseUrl: string;
  network: PublicConfigNetwork;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  /** Browser localStorage by default; null disables persistent storage. */
  storage?: PublicConfigStorage | null;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Validate network/version and verify the response's identity digest before login. */
export async function validatePublicConfig(input: unknown, network: PublicConfigNetwork): Promise<PublicConfig> {
  const config = publicConfigSchema.parse(input);
  if (config.network !== network || config.identityId !== `miso-${network}-v1`)
    throw new Error("Public configuration targets a different account identity");
  const { fingerprint, ...identity } = config;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(identity)));
  const actual = `sha256:${Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("")}`;
  if (fingerprint !== actual) throw new Error("Public configuration fingerprint does not match");
  Object.freeze(config.auth.google);
  Object.freeze(config.auth.enoki);
  Object.freeze(config.auth);
  return Object.freeze(config);
}
function browserStorage(): PublicConfigStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
function removeCached(storage: PublicConfigStorage | null | undefined, key: string) {
  try { storage?.removeItem(key); } catch { /* Storage can be disabled or full. */ }
}
/** Uses validated seven-day browser storage and HTTP caching; never embeds an identity. */
export async function fetchPublicConfig(options: PublicConfigOptions): Promise<PublicConfig> {
  const url = new URL("/v1/config", options.baseUrl);
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const key = `miso:public-config:v1:${options.network}:${url.href}`;
  options.signal?.throwIfAborted();
  try {
    const raw = storage?.getItem(key);
    if (raw && raw.length <= 20_000) {
      const entry = JSON.parse(raw);
      const age = Date.now() - entry.cachedAt;
      if (Number.isSafeInteger(entry.cachedAt) && age >= 0 && age < PUBLIC_CONFIG_MAX_AGE_MS) {
        const config = await validatePublicConfig(entry.config, options.network);
        options.signal?.throwIfAborted();
        return config;
      }
    }
  } catch { /* Discard corrupt entries and fetch the authoritative response. */ }
  options.signal?.throwIfAborted();
  removeCached(storage, key);
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  const response = await (options.fetch ?? globalThis.fetch)(url.toString(), {
    headers: { Accept: "application/json" }, credentials: "omit", cache: "default",
    redirect: "error", signal,
  });
  if (!response.ok) throw new Error(`Public configuration unavailable (HTTP ${response.status})`);
  const text = await response.text();
  if (text.length > 16_384) throw new Error("Public configuration response is too large");
  const config = await validatePublicConfig(JSON.parse(text), options.network);
  signal.throwIfAborted();
  // Preserve the age of an HTTP/edge cache hit instead of resetting its lifetime.
  const ageSeconds = Number(response.headers.get("age") ?? 0);
  const date = Date.parse(response.headers.get("date") ?? "");
  const responseAge = Math.max(Number.isFinite(ageSeconds) ? Math.max(0, ageSeconds) * 1000 : 0,
    Number.isFinite(date) ? Math.max(0, Date.now() - date) : 0);
  try { storage?.setItem(key, JSON.stringify({ cachedAt: Date.now() - responseAge, config })); } catch { /* Login still works without storage. */ }
  return config;
}
