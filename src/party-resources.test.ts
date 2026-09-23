import { expect, test } from "bun:test";
import { createMisoApiClient, MisoApiContractError } from "./client.js";
import { partyCoreSchema, partyRolesSchema } from "./schemas.js";
import { partyCachePolicy, partyQueryPolicy } from "./cache.js";

const resources = ["Core", "Profile", "Members", "Genres", "Links", "Ctas", "Roles", "Tags"] as const;
function fixture(body: unknown, status = 200) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: new URL(input), init });
    return Response.json(body, { status });
  }) as typeof globalThis.fetch;
  return { calls, api: createMisoApiClient({ baseUrl: "https://api.mainnet.miso.fm", modularPrefix: "/custom/v1", fetch, version: () => "1700000000-deadbeef" }) };
}
for (const resource of resources) {
  test(`party ${resource} uses modular prefix, 404 null and versioned no-store`, async () => {
    const { calls, api } = fixture({}, 404);
    expect(await api[`getParty${resource}`]("0xAb")).toBeNull();
    expect(calls[0]!.url.pathname).toBe(`/custom/v1/parties/0xAb${resource === "Core" ? "" : `/${resource.toLowerCase()}`}`);
    expect(calls[0]!.url.searchParams.get("v")).toBe("1700000000-deadbeef");
    expect(calls[0]!.init!.cache).toBe("no-store");
  });
}
test("party batch has explicit bounds and preserves caller order", async () => {
  const { calls, api } = fixture([{ id: "0x2", kind: "group", name: "Two" }]);
  expect(await api.listParties([])).toEqual([]);
  expect(calls).toHaveLength(0);
  await expect(api.listParties(Array(101).fill("0x1"))).rejects.toThrow("100");
  expect(calls).toHaveLength(0);
  expect(await api.listParties(["0x2", "0x1"])).toHaveLength(1);
  expect(calls[0]!.url.pathname).toBe("/custom/v1/parties");
  expect(calls[0]!.url.searchParams.get("ids")).toBe("0x2,0x1");
  expect(calls[0]!.init!.cache).toBe("no-store");
});
test("party resources reject malformed payloads and preserve role identity", async () => {
  const core = { id: "0x1", kind: "individual", name: "One", createdAtMs: 1 };
  expect(partyCoreSchema.safeParse({ ...core, links: [] }).success).toBe(false);
  const roles = { partyId: "0x1", roles: [{ kind: "artist" as const }, { kind: "custom" as const, name: "artist" }] };
  expect(partyRolesSchema.parse(roles)).toEqual(roles);
  const { api } = fixture({ partyId: "0x1", profile: { bioShort: "bad" } });
  await expect(api.getPartyProfile("0x1")).rejects.toBeInstanceOf(MisoApiContractError);
});
test("party policy does not depend on work state", () => {
  expect(partyCachePolicy()).toEqual({ browserMaxAge: 30, edgeMaxAge: 60, staleWhileRevalidate: 300 });
  expect(partyQueryPolicy()).toEqual({ staleTime: 30000 });
  expect(partyQueryPolicy({ versioned: true })).toEqual({ staleTime: 0 });
});
