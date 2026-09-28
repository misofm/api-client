import { expect, test } from "bun:test";
import { createMisoApiClient, MisoApiContractError } from "./client.js";
import * as s from "./schemas.js";
const id = `0x${"1".repeat(64)}`;
const type = "0x2::sui::SUI";
const empty = { nextCursor: null };
const cap = { capId: id, kind: "composition", custody: "direct", shareType: type, workId: null, vaultId: null };
const maxU128 = "340282366920938463463374607431768211455";
const listing = { id, pressingId: id, releaseId: id, pricing: { kind: "fixed" as const, amount: "1000000" }, currencyType: type, state: "enabled" as const, totalProceeds: maxU128 };
const sale = { listingId: id, pressingId: id, releaseId: id, recordId: id, edition: 1, number: 1, purchaseCurrency: type, purchasePrice: "1000000", purchasedBy: id, purchasedTimestampMs: "9007199254740993", pricing: { kind: "fixed", amount: "1000000" } };

const cases: [string, string, unknown, (api: ReturnType<typeof createMisoApiClient>) => Promise<unknown>][] = [
  ["pressing", `/pressings/${id}`, { id, releaseId: id, edition: 1, supply: 3, maxSupply: 100, distributors: [] }, api => api.getPressingCore(id)],
  ["listing", `/pressings/${id}/listing`, listing, api => api.getPressingListingResource(id, type)],
  ["record", `/records/${id}`, { id, releaseId: id, pressingId: id, edition: 1, number: 1 }, api => api.getRecordCore(id)],
  ["purchase", `/records/${id}/purchase`, { recordId: id, purchaseCurrency: type, purchasePrice: "9007199254740993", purchasedBy: id, purchasedTimestampMs: "9007199254740993" }, api => api.getRecordPurchase(id)],
  ["invitations", `/parties/${id}/pending-memberships`, { partyId: id, groupIds: [] }, api => api.getPartyPendingMemberships(id)],
  ["records page", `/wallets/${id}/records`, { records: [], ...empty }, api => api.listWalletRecordReferences(id, { cursor: "opaque", limit: 2 })],
  ["party caps", `/wallets/${id}/party-capabilities`, { capabilities: [], ...empty }, api => api.listWalletPartyCapabilities(id)],
  ["work caps", `/wallets/${id}/work-capabilities`, { capabilities: [cap], ...empty }, api => api.listWalletWorkCapabilities(id, { kind: "composition", custody: "direct" })],
  ["cap", `/work-capabilities/${id}`, cap, api => api.getWorkCapability(id)],
  ["work reference", `/work-capabilities/${id}/work`, { capId: id, kind: "composition", workId: null, shareType: type }, api => api.getWorkCapabilityReference(id)],
  ["balance", `/wallets/${id}/balance`, { address: id, coinType: type, balance: "9007199254740995", coinBalance: "9007199254740993", addressBalance: "2" }, api => api.getWalletBalanceResource(id, type)],
  ["metadata", `/coins/${encodeURIComponent(type)}/metadata`, { coinType: type, decimals: 9, name: "Sui", symbol: "SUI", description: "", iconUrl: null }, api => api.getCoinMetadata(type)],
  ["stake", `/stakes/${id}`, { id, shareType: type, balance: "9007199254740993" }, api => api.getStakeCore(id)],
  ["registrations", `/stakes/${id}/registrations`, { stakeId: id, registrations: [] }, api => api.getStakeRegistrations(id)],
  ["stakes page", `/wallets/${id}/stakes`, { stakes: [], ...empty }, api => api.listWalletStakeResources(id)],
  ["share reference", `/shares/${encodeURIComponent(type)}/work`, { kind: "composition", workId: id, shareType: type }, api => api.getShareWorkReference(type, "composition")],
  ["party ownership", `/wallets/${id}/parties/${id}/ownership`, { address: id, objectId: id, isOwner: false, capId: id }, api => api.getPartyOwnershipResource(id, id)],
  ["record ownership", `/wallets/${id}/records/${id}/ownership`, { address: id, objectId: id, isOwner: false }, api => api.getRecordOwnershipResource(id, id)],
  ["royalty claims", `/wallets/${id}/royalty-claims`, { claims: [], nextCursor: "next", availableFromMs: null }, api => api.listWalletRoyaltyClaimsResource(id, { before: "opaque", limit: 10 })],
  ["transaction sale", `/transactions/digest/sales/${id}`, { transactionDigest: "digest", sale }, api => api.getTransactionSale("digest", id)],
];
for (const [name, path, body, invoke] of cases) test(`remaining resource ${name}: schema and modular prefix`, async () => {
  let seen: Request | undefined;
  const api = createMisoApiClient({ baseUrl: "https://api.test", prefix: "/old", modularPrefix: "/v1", version: () => "1790000000-deadbeef", fetch: Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => { seen = new Request(input, init); return Response.json(body); }, { preconnect: fetch.preconnect }) });
  expect(await invoke(api)).toEqual(body);
  expect(new URL(seen!.url).pathname).toBe(`/v1${path}`);
  expect(new URL(seen!.url).searchParams.get("v")).toBe("1790000000-deadbeef");
  expect(seen!.cache).toBe("no-store");
});
test.each(["balance", "coinBalance", "addressBalance"])("malformed %s rejects through the contract error instead of throwing from BigInt", async field => {
  const body = { address: id, coinType: type, balance: "1", coinBalance: "1", addressBalance: "0", [field]: "garbage" };
  expect(s.walletBalanceResourceSchema.safeParse(body).success).toBe(false);
  const api = createMisoApiClient({ baseUrl: "https://api.test", fetch: Object.assign(async () => Response.json(body), { preconnect: fetch.preconnect }) });
  await expect(api.getWalletBalanceResource(id, type)).rejects.toBeInstanceOf(MisoApiContractError);
});
test("listing retains exact proceeds and rejects guessed currency metadata", () => {
  expect(s.pressingListingResourceSchema.parse(listing)).toEqual(listing);
  expect(s.pressingListingResourceSchema.safeParse({ ...listing, totalProceeds: (1n << 128n).toString() }).success).toBe(false);
  expect(s.pressingListingResourceSchema.safeParse({ ...listing, totalProceeds: "garbage" }).success).toBe(false);
  expect(s.pressingListingResourceSchema.safeParse({ ...listing, currency: { type, symbol: "SUI", decimals: 9 } }).success).toBe(false);
});
test("required pages fail on absence while singletons return null", async () => {
  const api = createMisoApiClient({ baseUrl: "https://api.test", fetch: Object.assign(async () => Response.json({ error: { code: "not_found", message: "missing" } }, { status: 404 }), { preconnect: fetch.preconnect }) });
  expect(await api.getRecordCore(id)).toBeNull();
  await expect(api.listWalletRecordReferences(id)).rejects.toMatchObject({ status: 404 });
});
test("new resources reject invalid balances and aggregate-shaped records", () => {
  expect(s.walletBalanceResourceSchema.safeParse({ address: id, coinType: type, balance: "3", coinBalance: "1", addressBalance: "1" }).success).toBe(false);
  expect(s.recordCoreSchema.safeParse({ id, releaseId: id, pressingId: id, edition: 1, number: 1, release: {} }).success).toBe(false);
});
test("request options retain caller cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  const api = createMisoApiClient({ baseUrl: "https://api.test", fetch: Object.assign(async (_: RequestInfo | URL, init?: RequestInit) => { expect(init?.signal).toBe(controller.signal); return Response.json({}); }, { preconnect: fetch.preconnect }) });
  await expect(api.getRecordCore(id, { signal: controller.signal })).rejects.toBeInstanceOf(MisoApiContractError);
});
