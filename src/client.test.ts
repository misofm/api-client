// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
  cacheBuster,
  createMisoApiClient,
  MisoApiContractError,
  MisoApiError,
  READ_CACHE_CLASS,
} from "./client.js";
import { trackViewSchema } from "./schemas.js";
import type { WorkDetail } from "./types.js";

/** A fetch that records the URL it was called with and replays a canned response. */
function stubFetch(response: {
  status?: number;
  body?: unknown;
  headers?: HeadersInit;
}) {
  const calls: string[] = [];
  const initCalls: RequestInit[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push(String(input));
    initCalls.push(init ?? {});
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json");
    return new Response(
      response.body === undefined ? "" : JSON.stringify(response.body),
      {
        status: response.status ?? 200,
        headers,
      },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, initCalls };
}

const BASE = "https://api.testnet.miso.fm";

const balance = {
  address: "0xabc",
  coinType: "0x7777::fakeusd::FakeUsd",
  balance: "100000000",
  coinBalance: "60000000",
  addressBalance: "40000000",
  decimals: 6,
};

const workDetails: WorkDetail[] = [
  {
    capId: "0x1",
    kind: "composition",
    workId: "0x2",
    title: "Ghost",
    state: "Published",
    royaltyRateBps: 500,
    shareType: "0x3::share::SHARE",
  },
  {
    capId: "0x4",
    kind: "recording",
    workId: "0x5",
    title: "Ghost",
    state: "Initialized",
    shareType: "0x6::share::SHARE",
  },
  {
    capId: "0x7",
    kind: "release",
    workId: "0x8",
    title: "Ghost EP",
    state: "Published",
    discCount: 1,
    trackCount: 2,
  },
];

describe("URL construction", () => {
  test("mounts resources under the public v1 prefix by default", async () => {
    const { fetch, calls } = stubFetch({ body: balance });
    await createMisoApiClient({ baseUrl: BASE, fetch }).getBalance("0xabc");
    expect(calls[0]).toBe(`${BASE}/v1/wallets/0xabc/balance`);
  });

  test("tolerates a trailing slash on the base URL", async () => {
    const { fetch, calls } = stubFetch({ body: balance });
    await createMisoApiClient({ baseUrl: `${BASE}/`, fetch }).getBalance(
      "0xabc",
    );
    expect(calls[0]).toBe(`${BASE}/v1/wallets/0xabc/balance`);
  });

  test("omits empty query params rather than sending them blank", async () => {
    const { fetch, calls } = stubFetch({ body: balance });
    await createMisoApiClient({ baseUrl: BASE, fetch }).getBalance(
      "0xabc",
      undefined,
    );
    expect(calls[0]).not.toContain("coinType");
  });

  test("sends an explicit coin type when given one", async () => {
    const { fetch, calls } = stubFetch({ body: balance });
    await createMisoApiClient({ baseUrl: BASE, fetch }).getBalance(
      "0xabc",
      "0x2::sui::SUI",
    );
    expect(calls[0]).toContain("coinType=0x2%3A%3Asui%3A%3ASUI");
  });

  test("joins the artist include list into one param", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    await createMisoApiClient({ baseUrl: BASE, fetch }).getArtist("0xp", {
      include: ["roles", "tags"],
    });
    expect(calls[0]).toContain("include=roles%2Ctags");
  });

  test("preserves canonical and same-named custom role identities", async () => {
    const { fetch } = stubFetch({
      body: {
        id: "0x1",
        kind: "individual",
        name: "Role Test",
        createdAtMs: 1,
        bioShort: null,
        bioLong: null,
        country: null,
        languages: [],
        genres: [],
        links: [],
        ctas: [],
        members: [],
        roles: ["Artist", "Artist"],
        roleValues: [{ kind: "artist" }, { kind: "custom", name: "Artist" }],
        tags: [],
        avatarUrl: "https://api.test/media/avatar/0x1",
      },
    });
    const artist = await createMisoApiClient({ baseUrl: BASE, fetch }).getArtist("0x1", {
      include: ["roles", "tags"],
    });
    expect(artist?.roleValues).toEqual([
      { kind: "artist" },
      { kind: "custom", name: "Artist" },
    ]);
  });

  test("joins catalog relationship expansions into one param", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    const client = createMisoApiClient({ baseUrl: BASE, fetch });
    await client.getRelease("0xl", { include: ["trackCredits"] });
    await client.getRecordAlbum("0xr", {
      include: ["release", "trackCredits"],
    });
    expect(calls[0]).toContain("include=trackCredits");
    expect(calls[1]).toContain("include=release%2CtrackCredits");
  });

  test("passes the currency to the modular Listing route", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    await createMisoApiClient({ baseUrl: BASE, fetch }).getListing(
      "0xp",
      "0x2::sui::SUI",
    );
    expect(calls[0]).toBe(
      `${BASE}/v1/pressings/0xp/listing?currencyType=0x2%3A%3Asui%3A%3ASUI`,
    );
  });

  test("a custom prefix is honored (self-hosted / direct-to-service)", async () => {
    const { fetch, calls } = stubFetch({ body: balance });
    await createMisoApiClient({
      baseUrl: BASE,
      fetch,
      prefix: "/v1",
    }).getBalance("0xabc");
    expect(calls[0]).toBe(`${BASE}/v1/wallets/0xabc/balance`);
  });

  test("retains a legacy or service-specific prefix exactly when configured", async () => {
    const { fetch, calls } = stubFetch({ body: balance });
    await createMisoApiClient({
      baseUrl: BASE,
      fetch,
      prefix: "/read/v1/",
    }).getWalletBalance("0xabc");
    expect(calls[0]).toBe(`${BASE}/read/v1/wallets/0xabc/balance`);
  });

  for (const value of [
    "../../health",
    "0x1?admin=true",
    "0x1#fragment",
    "0x1%2F..%2Fhealth",
  ]) {
    test(`encodes hostile path input as one segment: ${value}`, async () => {
      const { fetch, calls } = stubFetch({ status: 404 });
      await createMisoApiClient({ baseUrl: BASE, fetch }).getPressing(value);
      expect(new URL(calls[0]!).pathname).toBe(
        `/v1/pressings/${encodeURIComponent(value)}`,
      );
      expect(new URL(calls[0]!).search).toBe("");
      expect(new URL(calls[0]!).hash).toBe("");
    });
  }

  for (const value of [".", ".."]) {
    test(`confines WHATWG dot-segment input: ${value}`, async () => {
      const { fetch, calls } = stubFetch({ status: 404 });
      await createMisoApiClient({ baseUrl: BASE, fetch }).getPressing(value);
      const pathname = new URL(calls[0]!).pathname;
      expect(pathname.startsWith("/v1/pressings/")).toBe(true);
      expect(pathname).toContain("%252E");
    });
  }

  test("encodes every dynamic position, including both receipt segments", async () => {
    const hostile = "../../health?x#y%";
    const encoded = encodeURIComponent(hostile);
    const { fetch, calls } = stubFetch({ status: 404 });
    const api = createMisoApiClient({ baseUrl: BASE, fetch });

    await api.getPressingListing(hostile, "coin");
    await api.getRelease(hostile);
    await api.getRecordAlbum(hostile);
    await api.getArtist(hostile);
    await api.getWork(hostile);
    await api.getPurchaseReceipt(hostile, hostile);
    await api.listWalletRecords(hostile).catch(() => undefined);

    expect(calls.map((call) => new URL(call).pathname)).toEqual([
      `/v1/pressings/${encoded}/listing`,
      `/v1/releases/${encoded}`,
      `/v1/records/${encoded}/album`,
      `/v1/artists/${encoded}`,
      `/v1/work-capabilities/${encoded}/work`,
      `/v1/transactions/${encoded}/receipts/${encoded}`,
      `/v1/wallets/${encoded}/records`,
    ]);
  });

  test("uses record-discriminated receipts and retains the explicit legacy method", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    const api = createMisoApiClient({ baseUrl: BASE, fetch });
    await api.getPurchaseReceipt("digest", "0xrecord");
    await api.getReceipt("0xpressing", "digest");
    expect(calls.map((call) => new URL(call).pathname)).toEqual([
      "/v1/transactions/digest/receipts/0xrecord",
      "/v1/receipts/0xpressing/digest",
    ]);
  });

  test("offers one canonical ownership method with a discriminated target", async () => {
    const { fetch, calls } = stubFetch({
      body: { address: "0xabc", objectId: "0x1", isOwner: false },
    });
    const api = createMisoApiClient({ baseUrl: BASE, fetch });
    await api.getWalletOwnership("0xabc", { partyId: "0xparty" });
    await api.getWalletOwnership("0xabc", { recordId: "0xrecord" });
    expect(new URL(calls[0]!).pathname).toBe("/v1/wallets/0xabc/ownership");
    expect(new URL(calls[1]!).pathname).toBe("/v1/wallets/0xabc/ownership");
    expect(new URL(calls[0]!).searchParams.get("party")).toBe("0xparty");
    expect(new URL(calls[0]!).searchParams.has("record")).toBe(false);
    expect(new URL(calls[1]!).searchParams.get("record")).toBe("0xrecord");
    expect(new URL(calls[1]!).searchParams.has("party")).toBe(false);
  });

  test("lists wallet work details with one fixed bulk request", async () => {
    const { fetch, calls } = stubFetch({ body: workDetails });
    const result = await createMisoApiClient({ baseUrl: BASE, fetch })
      .listWalletWorkDetails("0xabc");

    expect(result).toEqual(workDetails);
    expect(calls).toEqual([
      `${BASE}/v1/wallets/0xabc/work-details`,
    ]);
  });
});

describe("request options", () => {
  test("forwards a per-call AbortSignal and custom headers", async () => {
    const { fetch, initCalls } = stubFetch({ body: balance });
    const controller = new AbortController();
    await createMisoApiClient({ baseUrl: BASE, fetch }).getWalletBalance(
      "0xabc",
      undefined,
      {
        signal: controller.signal,
        headers: { Authorization: "Bearer test", "X-Client": "example" },
      },
    );

    expect(initCalls[0]?.signal).toBe(controller.signal);
    const headers = new Headers(initCalls[0]?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer test");
    expect(headers.get("x-client")).toBe("example");
  });

  test("forwards cancellation options through the bulk work-details read", async () => {
    const { fetch, initCalls } = stubFetch({ body: workDetails });
    const controller = new AbortController();
    await createMisoApiClient({ baseUrl: BASE, fetch }).listWalletWorkDetails(
      "0xabc",
      { signal: controller.signal },
    );

    expect(initCalls[0]?.signal).toBe(controller.signal);
  });
});

describe("not-found handling", () => {
  test("an unknown pressing is null, not an error", async () => {
    const { fetch } = stubFetch({
      status: 404,
      body: { error: { code: "not_found", message: "gone" } },
    });
    expect(
      await createMisoApiClient({ baseUrl: BASE, fetch }).getPressing("0xdead"),
    ).toBeNull();
  });

  test("an unknown artist is null", async () => {
    const { fetch } = stubFetch({
      status: 404,
      body: { error: { code: "not_found", message: "gone" } },
    });
    expect(
      await createMisoApiClient({ baseUrl: BASE, fetch }).getArtist("0xdead"),
    ).toBeNull();
  });

  test("an empty id list short-circuits without a request", async () => {
    const { fetch, calls } = stubFetch({ body: [] });
    expect(
      await createMisoApiClient({ baseUrl: BASE, fetch }).getArtists([]),
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("error handling", () => {
  test("surfaces the server's error code and message", async () => {
    const { fetch } = stubFetch({
      status: 429,
      body: { error: { code: "rate-limited", message: "Too many requests." } },
    });
    const api = createMisoApiClient({ baseUrl: BASE, fetch });
    await expect(api.getPressing("0xp")).rejects.toThrow(MisoApiError);
    try {
      await api.getPressing("0xp");
    } catch (e) {
      expect(e).toBeInstanceOf(MisoApiError);
      expect((e as MisoApiError).status).toBe(429);
      expect((e as MisoApiError).code).toBe("rate-limited");
      expect((e as MisoApiError).message).toBe("Too many requests.");
    }
  });

  test("surfaces request correlation and retry metadata from headers", async () => {
    const { fetch } = stubFetch({
      status: 429,
      body: { error: { code: "rate_limited", message: "Slow down." } },
      headers: { "X-Request-Id": "req_123", "Retry-After": "17" },
    });
    const error = await createMisoApiClient({ baseUrl: BASE, fetch })
      .getPressing("0xp")
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(MisoApiError);
    expect((error as MisoApiError).requestId).toBe("req_123");
    expect((error as MisoApiError).retryAfter).toBe(17);
  });

  test("an error body in an unexpected shape still throws a usable error", async () => {
    const { fetch } = stubFetch({ status: 500, body: { oops: true } });
    try {
      await createMisoApiClient({ baseUrl: BASE, fetch }).getPressing("0xp");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MisoApiError);
      expect((e as MisoApiError).code).toBe("unknown");
    }
  });

  test("a 404 on an endpoint that must return a body is an error, not null", async () => {
    const { fetch } = stubFetch({
      status: 404,
      body: { error: { code: "not_found", message: "gone" } },
    });
    await expect(
      createMisoApiClient({ baseUrl: BASE, fetch }).getWalletRecords("0xabc"),
    ).rejects.toThrow(MisoApiError);
  });

  test("a stale indexer 503 remains an error rather than becoming null or empty", async () => {
    const { fetch, calls } = stubFetch({
      status: 503,
      body: {
        error: { code: "indexer_not_ready", message: "Index is refreshing." },
      },
      headers: { "Retry-After": "5" },
    });
    const error = await createMisoApiClient({ baseUrl: BASE, fetch })
      .listWalletWorkDetails("0xabc")
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(MisoApiError);
    expect((error as MisoApiError).status).toBe(503);
    expect((error as MisoApiError).code).toBe("indexer_not_ready");
    expect((error as MisoApiError).retryAfter).toBe(5);
    expect(calls).toHaveLength(1);
  });
});

describe("contract validation", () => {
  test("preserves and validates a track's optional plain Walrus audio blob ids", () => {
    const track = {
      no: "1",
      title: "Ghost",
      recording: { id: "0x1", state: { type: "Published" as const, timestampMs: 1 }, compositionId: "0x2" },
      composition: { id: "0x2", state: { type: "Published" as const, timestampMs: 1 }, title: "Ghost", royaltyRate: { value: 2_000 } },
      splitBps: 10_000,
      disc: 1,
      masterBlobId: "VwMOwKRnoRohGqEfRvE_21IUqOLaBp7pbyXnwD68UAE",
      transcodeQuiltId: "h23-eMAzJekI1fSvMJrAg-YiU2p0LCXM9zrzwpVPxLY",
      engineSession: {
        sessionBlobId: "PeqJYPS46oXjALZ9KbH0ZNCESLx8bssjvGWWanXZfl4",
        stems: [
          {
            digest: "ba8f39a6c7b1f22bded6ce6d97361a01ce751282b3f1ab08f931b876c6734ae1",
            blobId: "jvHC9wQwEl8l_NR4u5fX7n8tV6A5GrgWn2E47Y0eYS4",
          },
        ],
      },
    };
    expect(trackViewSchema.parse(track)).toEqual(track);
    expect(() =>
      trackViewSchema.parse({ ...track, masterBlobId: "not-a-blob-id" }),
    ).toThrow();
    expect(() =>
      trackViewSchema.parse({ ...track, transcodeQuiltId: "not-a-quilt-id" }),
    ).toThrow();
    expect(() =>
      trackViewSchema.parse({
        ...track,
        engineSession: { ...track.engineSession, stems: [{ digest: "SHA", blobId: track.masterBlobId }] },
      }),
    ).toThrow();
  });

  test("a response missing a required field fails loudly at the boundary", async () => {
    const { fetch } = stubFetch({
      body: {
        address: "0xabc",
        coinType: "0x2::sui::SUI",
        balance: "100",
        coinBalance: "60",
        decimals: 9,
      },
    }); // no addressBalance
    await expect(
      createMisoApiClient({ baseUrl: BASE, fetch }).getBalance("0xabc"),
    ).rejects.toThrow(MisoApiContractError);
  });

  test("a u64 sent as a NUMBER is rejected — the precision bug this contract exists to prevent", async () => {
    const { fetch } = stubFetch({ body: { ...balance, balance: 100000000 } });
    const err = await createMisoApiClient({ baseUrl: BASE, fetch })
      .getBalance("0xabc")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MisoApiContractError);
  });

  test("the contract error names the field and points at version skew", async () => {
    const { fetch } = stubFetch({
      body: { ...balance, balance: "not-a-number" },
      headers: { "X-Request-ID": "contract_req_1" },
    });
    try {
      await createMisoApiClient({ baseUrl: BASE, fetch }).getBalance("0xabc");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("balance");
      expect((e as Error).message).toContain("different versions");
      expect((e as MisoApiContractError).requestId).toBe("contract_req_1");
    }
  });

  test("a valid response parses through to typed data", async () => {
    const { fetch } = stubFetch({ body: balance });
    const result = await createMisoApiClient({
      baseUrl: BASE,
      fetch,
    }).getBalance("0xabc");
    expect(result).toEqual(balance);
  });

  test("preserves both Sui balance storage classes", async () => {
    const { fetch } = stubFetch({ body: balance });
    const result = await createMisoApiClient({ baseUrl: BASE, fetch })
      .getBalance("0xabc");
    expect(result.coinBalance).toBe("60000000");
    expect(result.addressBalance).toBe("40000000");
  });

  test("rejects an inconsistent balance aggregate", async () => {
    const { fetch } = stubFetch({
      body: { ...balance, balance: "99999999" },
    });
    await expect(
      createMisoApiClient({ baseUrl: BASE, fetch }).getBalance("0xabc"),
    ).rejects.toThrow(MisoApiContractError);
  });
});

describe("READ_CACHE_CLASS", () => {
  test("classifies both bulk work-details names as private", () => {
    expect(READ_CACHE_CLASS.listWalletWorkDetails).toBe("private");
    expect(READ_CACHE_CLASS.getWalletWorkDetails).toBe("private");
  });

  test("every wallet-scoped read is private", () => {
    for (const [method, cls] of Object.entries(READ_CACHE_CLASS)) {
      if (
        method.startsWith("getWallet") ||
        method.startsWith("listWallet") ||
        method.startsWith("owns") ||
        method === "getBalance" ||
        method === "getWork"
      ) {
        expect(cls).toBe("private");
      }
    }
  });

  test("reads whose answer can never change are immutable", () => {
    expect(READ_CACHE_CLASS.getRecordAlbum).toBe("immutable");
    expect(READ_CACHE_CLASS.getReceipt).toBe("immutable");
    expect(READ_CACHE_CLASS.getPurchaseReceipt).toBe("immutable");
  });

  test("live sale reads are the sale class", () => {
    expect(READ_CACHE_CLASS.getPressing).toBe("sale");
    expect(READ_CACHE_CLASS.getListing).toBe("sale");
    expect(READ_CACHE_CLASS.getPressingListing).toBe("sale");
  });
});

describe("canonical aliases", () => {
  test("keeps semantically identical legacy methods as the same implementation", () => {
    const api = createMisoApiClient({ baseUrl: BASE, fetch: stubFetch({}).fetch });
    expect(api.getListing).toBe(api.getPressingListing);
    expect(api.getArtists).toBe(api.listArtists);
    expect(api.getWalletRecords).toBe(api.listWalletRecords);
    expect(api.getWalletParties).toBe(api.listWalletParties);
    expect(api.getPendingMemberships).toBe(api.listWalletPendingMemberships);
    expect(api.getWalletWorks).toBe(api.listWalletWorks);
    expect(api.getWalletWorkDetails).toBe(api.listWalletWorkDetails);
    expect(api.getBalance).toBe(api.getWalletBalance);
    expect(api.ownsParty).toBe(api.getWalletPartyOwnership);
    expect(api.ownsRecord).toBe(api.getWalletRecordOwnership);
    expect(api.getReceipt).not.toBe(api.getPurchaseReceipt);
  });
});

describe("cache buster", () => {
  test("no `v` is sent until something has been written", async () => {
    const { fetch, calls } = stubFetch({ body: balance });
    await createMisoApiClient({ baseUrl: BASE, fetch }).getBalance("0xabc");
    expect(calls[0]).not.toContain("v=");
  });

  test("a supplied version rides on mutable public reads", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    const api = createMisoApiClient({
      baseUrl: BASE,
      fetch,
      version: () => "1699999999",
    });
    await api.getPressing("0xabc");
    expect(calls[0]).toContain("v=1699999999");
  });

  test("the version is read per request, so one client can be bumped in place", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    let v: string | undefined;
    const api = createMisoApiClient({ baseUrl: BASE, fetch, version: () => v });
    await api.getPressing("0xabc");
    v = "42";
    await api.getPressing("0xabc");
    expect(calls[0]).not.toContain("v=");
    expect(calls[1]).toContain("v=42");
  });

  test("does not duplicate private or immutable reads with a global version", async () => {
    let versionCalls = 0;
    const privateStub = stubFetch({ body: balance });
    const privateApi = createMisoApiClient({
      baseUrl: BASE,
      fetch: privateStub.fetch,
      version: () => {
        versionCalls += 1;
        return "42";
      },
    });
    await privateApi.getWalletBalance("0xabc");

    const immutableStub = stubFetch({ status: 404 });
    const immutableApi = createMisoApiClient({
      baseUrl: BASE,
      fetch: immutableStub.fetch,
      version: () => {
        versionCalls += 1;
        return "42";
      },
    });
    await immutableApi.getPurchaseReceipt("0xp", "tx");
    await immutableApi.getRecordAlbum("0xr");

    expect(versionCalls).toBe(0);
    expect([
      ...privateStub.calls,
      ...immutableStub.calls,
    ].every((call) => !new URL(call).searchParams.has("v"))).toBe(true);
  });

  test("expanded record albums remain bustable because release metadata can move", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    await createMisoApiClient({
      baseUrl: BASE,
      fetch,
      version: () => "42",
    }).getRecordAlbum("0xr", { include: ["release"] });
    expect(new URL(calls[0]!).searchParams.get("v")).toBe("42");
  });

  test("cacheBuster combines a bounded timestamp with an unpredictable namespace", () => {
    expect(cacheBuster(1_700_000_000_123, "DEADBEEF")).toBe(
      "1700000000-deadbeef",
    );
    expect(cacheBuster(1_700_000_000_123, "deadbeef")).not.toBe(
      cacheBuster(1_700_000_000_123, "0123abcd"),
    );
    expect(cacheBuster()).toMatch(/^\d{10}-[0-9a-f]{8}$/);
    expect(() => cacheBuster(1_700_000_000_123, "predictable"))
      .toThrow(RangeError);
  });
});

describe("royalty claims", () => {
  const page = {
    claims: [
      {
        txDigest: "FADgaLwmuoyiGgcFvqGyuXd5emk1Zq46cNH1p44Ca73U",
        timestampMs: 1788953314915,
        entries: [
          {
            poolId: "0x8619266a87ff5615803f3d4256ec90906f7b74828cc7f7f891941ff8d2a75e28",
            stakeId: "0x77bd5f2852455cb897c7c210c943ac7a959817891dcc20b3839914a4079a857b",
            shareType: "0x7805::share::Share",
            currency: "0x7777::fakeusd::FakeUsd",
            amount: "23800000",
          },
        ],
      },
    ],
    nextCursor: "KAFCCggAEMSQr+oOGAU=",
    availableFromMs: 1786601343736,
  };

  test("reads the newest page without a cursor and the next one with it", async () => {
    const { fetch, calls } = stubFetch({ body: page });
    const api = createMisoApiClient({ baseUrl: BASE, fetch });
    const first = await api.listWalletRoyaltyClaims("0xabc");
    expect(calls[0]).toBe(`${BASE}/v1/wallets/0xabc/royalty-claims`);
    expect(first.claims[0]?.entries[0]?.amount).toBe("23800000");

    await api.listWalletRoyaltyClaims("0xabc", { before: first.nextCursor, limit: 20 });
    expect(calls[1]).toBe(
      `${BASE}/v1/wallets/0xabc/royalty-claims?before=KAFCCggAEMSQr%2BoOGAU%3D&limit=20`,
    );
  });

  test("rejects a page whose amounts are not u64 strings", async () => {
    const broken = { ...page, claims: [{ ...page.claims[0], entries: [{ ...page.claims[0]!.entries[0], amount: "12.5" }] }] };
    const { fetch } = stubFetch({ body: broken });
    await expect(createMisoApiClient({ baseUrl: BASE, fetch }).listWalletRoyaltyClaims("0xabc")).rejects.toBeInstanceOf(
      MisoApiContractError,
    );
  });
});

describe("release description", () => {
  const release = {
    id: "0x1", title: "Release", subtitle: null, kind: null,
    state: { type: "Published", timestampMs: 123 }, publishedAtMs: 123, cover: null, credits: [],
    primaryArtists: [], discCount: 0, tracks: [],
  };
  for (const description of ["Behind the songs.\n制作の物語。", null, undefined]) {
    test(`preserves description and accepts older responses (${description === undefined ? "omitted" : description === null ? "null" : "text"})`, async () => {
      const { fetch } = stubFetch({ body: { ...release, ...(description === undefined ? {} : { description }) } });
      const result = await createMisoApiClient({ baseUrl: BASE, fetch }).getRelease("0x1");
      expect(result?.description).toBe(description ?? null);
    });
  }
});

describe("release genres", () => {
  const release = {
    id: "0x1", title: "Release", subtitle: null, description: null, kind: null,
    state: { type: "Published", timestampMs: 123 }, publishedAtMs: 123, cover: null, credits: [],
    primaryArtists: [], discCount: 0, tracks: [],
  };

  test("preserves ordered genres with the primary first", async () => {
    const { fetch } = stubFetch({ body: { ...release, genres: ["Electronic", "Alternative"] } });
    const result = await createMisoApiClient({ baseUrl: BASE, fetch }).getRelease("0x1");
    expect(result?.genres).toEqual(["Electronic", "Alternative"]);
  });

  test("defaults genres for an older response", async () => {
    const { fetch } = stubFetch({ body: release });
    const result = await createMisoApiClient({ baseUrl: BASE, fetch }).getRelease("0x1");
    expect(result?.genres).toEqual([]);
  });
});
