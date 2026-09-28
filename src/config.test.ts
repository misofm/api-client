import { expect, test } from "bun:test";
import { createMisoApiClient } from "./client.js";
import { fetchPublicConfig, validatePublicConfig } from "./config.js";
import { createHash } from "node:crypto";

const identity = {
  auth: { enoki: { publicKey: "enoki_public_" + "a".repeat(32) }, google: { clientId: "123-abc.apps.googleusercontent.com", issuer: "https://accounts.google.com" }, provider: "enoki" },
  identityId: "miso-mainnet-v1", network: "mainnet", schemaVersion: 1,
};
const payload = () => ({ ...identity, fingerprint: "sha256:" + createHash("sha256").update(JSON.stringify(identity)).digest("hex") });
test("fetches root config without credentials or cache-version query, with typed API method", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const client = createMisoApiClient({ baseUrl: "https://api.test", prefix: "/read/v1", version: () => "123", fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init }); return Response.json(payload());
  }) as unknown as typeof fetch });
  const result = await client.getPublicConfig("mainnet");
  expect(result.auth.google.clientId).toBe(identity.auth.google.clientId);
  expect(seen[0]!.url).toBe("https://api.test/v1/config");
  expect(seen[0]!.init).toMatchObject({ credentials: "omit", cache: "no-store", redirect: "error" });
  expect(Object.isFrozen(result.auth.enoki)).toBe(true);
});
test("rejects wrong network, altered key, identity ID, schema version, and additional fields", async () => {
  await expect(validatePublicConfig(payload(), "testnet")).rejects.toThrow();
  for (const value of [
    { ...payload(), schemaVersion: 2 }, { ...payload(), identityId: "miso-testnet-v1" },
    { ...payload(), fingerprint: "sha256:" + "0".repeat(64) }, { ...payload(), secret: "unexpected" },
    { ...payload(), auth: { ...identity.auth, enoki: { publicKey: "enoki_public_" + "b".repeat(32) } } },
  ]) await expect(validatePublicConfig(value, "mainnet")).rejects.toThrow();
});
test("fails closed on unavailable endpoint, non-JSON and invalid body without fallback", async () => {
  for (const response of [new Response("", { status: 503 }), new Response("<html>"), Response.json({})]) {
    await expect(fetchPublicConfig({ baseUrl: "https://api.test", network: "mainnet", fetch: (async () => response) as unknown as typeof fetch })).rejects.toThrow();
  }
});
test("propagates cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(fetchPublicConfig({ baseUrl: "https://api.test", network: "mainnet", signal: controller.signal, fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
    init!.signal!.throwIfAborted(); return Response.json(payload());
  }) as unknown as typeof fetch })).rejects.toThrow();
});
