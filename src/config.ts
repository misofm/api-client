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
export interface PublicConfigOptions {
  baseUrl: string;
  network: PublicConfigNetwork;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
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
/** Always uses the root /v1/config route, no catalog prefix, credentials, or fallback. */
export async function fetchPublicConfig(options: PublicConfigOptions): Promise<PublicConfig> {
  const url = new URL("/v1/config", options.baseUrl);
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  const response = await (options.fetch ?? globalThis.fetch)(url.toString(), {
    headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store",
    redirect: "error", signal,
  });
  if (!response.ok) throw new Error(`Public configuration unavailable (HTTP ${response.status})`);
  const text = await response.text();
  if (text.length > 16_384) throw new Error("Public configuration response is too large");
  return validatePublicConfig(JSON.parse(text), options.network);
}
