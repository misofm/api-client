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
  expect(seen[0]!.init).toMatchObject({ credentials: "omit", cache: "default", redirect: "error" });
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

function memoryStorage() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); } };
}
test("validated persistent config avoids the network across reloads", async () => {
  const storage = memoryStorage(); let calls = 0;
  const options = { baseUrl: "https://api.cache.test", network: "mainnet" as const, storage,
    fetch: (async () => { calls++; return Response.json(payload()); }) as unknown as typeof fetch };
  await fetchPublicConfig(options);
  await fetchPublicConfig({ ...options, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
  expect(calls).toBe(1);
  expect(storage.entries.size).toBe(1);
});
test("expired, future, malformed and modified cache entries cannot be reused", async () => {
  const storage = memoryStorage(); let calls = 0;
  const options = { baseUrl: "https://api.expiry.test", network: "mainnet" as const, storage,
    fetch: (async () => { calls++; return Response.json(payload()); }) as unknown as typeof fetch };
  await fetchPublicConfig(options);
  const key = [...storage.entries.keys()][0]!;
  for (const entry of [
    { cachedAt: Date.now() - 7 * 86400_000, config: payload() },
    { cachedAt: Date.now() + 86400_000, config: payload() },
    { cachedAt: Date.now(), config: { ...payload(), fingerprint: "sha256:" + "0".repeat(64) } },
    { cachedAt: Date.now(), config: { ...payload(), network: "testnet" } },
    { cachedAt: "now", config: payload() },
  ]) {
    storage.setItem(key, JSON.stringify(entry));
    await fetchPublicConfig(options);
  }
  storage.setItem(key, "not json");
  await fetchPublicConfig(options);
  expect(calls).toBe(7);
});
test("cache is partitioned by API origin and network; failures do not populate it", async () => {
  const storage = memoryStorage();
  const options = { baseUrl: "https://api.one.test", network: "mainnet" as const, storage,
    fetch: (async () => Response.json(payload())) as unknown as typeof fetch };
  await fetchPublicConfig(options);
  const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  await expect(fetchPublicConfig({ ...options, baseUrl: "https://api.two.test", fetch: offline })).rejects.toThrow("offline");
  await expect(fetchPublicConfig({ ...options, network: "testnet", fetch: offline })).rejects.toThrow("offline");
  expect(storage.entries.size).toBe(1);
});
test("storage errors do not prevent a valid response and HTTP age is retained", async () => {
  const blocked = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => { throw Error(); } };
  const options = { baseUrl: "https://api.age.test", network: "mainnet" as const,
    fetch: (async () => Response.json(payload(), { headers: { Age: "86400" } })) as unknown as typeof fetch };
  await expect(fetchPublicConfig({ ...options, storage: blocked })).resolves.toMatchObject({ network: "mainnet" });
  const storage = memoryStorage();
  await fetchPublicConfig({ ...options, storage });
  const saved = JSON.parse([...storage.entries.values()][0]!);
  expect(Date.now() - saved.cachedAt).toBeGreaterThanOrEqual(86400_000);
});
test("expired cache does not become an outage fallback and cancellation applies to cache hits", async () => {
  const storage = memoryStorage();
  const options = { baseUrl: "https://api.closed.test", network: "mainnet" as const, storage,
    fetch: (async () => Response.json(payload())) as unknown as typeof fetch };
  await fetchPublicConfig(options);
  const controller = new AbortController(); controller.abort();
  await expect(fetchPublicConfig({ ...options, signal: controller.signal })).rejects.toThrow();
  const key = [...storage.entries.keys()][0]!;
  storage.setItem(key, JSON.stringify({ cachedAt: Date.now() - 8 * 86400_000, config: payload() }));
  await expect(fetchPublicConfig({ ...options, fetch: (async () => new Response("", { status: 503 })) as unknown as typeof fetch })).rejects.toThrow("503");
  expect(storage.entries.size).toBe(0);
});
