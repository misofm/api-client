// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { createMisoApiClient, MisoApiContractError, MisoApiError } from "./client.js";

const BASE = "https://api.testnet.miso.fm";

function stubFetch(response: { status?: number; body?: unknown }) {
  const calls: string[] = [];
  const initCalls: RequestInit[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push(String(input));
    initCalls.push(init ?? {});
    return new Response(
      response.body === undefined ? "" : JSON.stringify(response.body),
      { status: response.status ?? 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, initCalls };
}

const methods = [
  ["getCompositionCore", "0x1", "/v1/compositions/0x1"],
  ["getCompositionCredits", "0x2", "/v1/compositions/0x2/credits"],
  ["getCompositionLyricsResource", "0x3", "/v1/compositions/0x3/lyrics"],
  ["getRecordingCore", "0x4", "/v1/recordings/0x4"],
  ["getRecordingCredits", "0x5", "/v1/recordings/0x5/credits"],
  ["getRecordingMaster", "0x6", "/v1/recordings/0x6/master"],
  ["getRecordingStream", "0x7", "/v1/recordings/0x7/stream"],
  ["getRecordingEngineSession", "0x8", "/v1/recordings/0x8/engine-session"],
  ["getReleaseCore", "0x9", "/v1/releases/0x9"],
  ["getReleaseTracks", "0xa", "/v1/releases/0xa/tracks"],
  ["getReleaseCredits", "0xb", "/v1/releases/0xb/credits"],
  ["getReleaseCover", "0xc", "/v1/releases/0xc/cover"],
  ["getReleaseKind", "0xd", "/v1/releases/0xd/kind"],
  ["getReleaseDescription", "0xe", "/v1/releases/0xe/description"],
  ["getReleaseGenres", "0xf", "/v1/releases/0xf/genres"],
] as const;

describe("modular client methods", () => {
  test("uses a separate modular root while preserving legacy routes", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    const api = createMisoApiClient({ baseUrl: BASE, fetch });
    await api.getRelease("0xlegacy");
    await api.getReleaseCore("0xmodular");
    expect(new URL(calls[0]!).pathname).toBe("/v1/protocol/releases/0xlegacy");
    expect(new URL(calls[1]!).pathname).toBe("/v1/releases/0xmodular");
  });

  test("covers every modular URL", async () => {
    const { fetch, calls } = stubFetch({ status: 404 });
    const api = createMisoApiClient({ baseUrl: BASE, fetch });
    for (const [name, id] of methods) {
      await (api[name] as (value: string) => Promise<unknown>)(id);
    }
    expect(calls.map((call) => new URL(call).pathname)).toEqual(methods.map(([, , path]) => path));
  });

  test("supports a custom modular prefix and hostile IDs", async () => {
    const hostile = "../../health?admin=true#fragment";
    const { fetch, calls } = stubFetch({ status: 404 });
    const api = createMisoApiClient({ baseUrl: `${BASE}/`, modularPrefix: "/gateway/v1/", fetch });
    await api.getRecordingStream(hostile);
    const url = new URL(calls[0]!);
    expect(url.pathname).toBe(`/gateway/v1/recordings/${encodeURIComponent(hostile)}/stream`);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  test("versions modular reads and bypasses browser cache", async () => {
    const { fetch, calls, initCalls } = stubFetch({ status: 404 });
    const api = createMisoApiClient({ baseUrl: BASE, fetch, version: () => "1700000000-deadbeef" });
    await api.getCompositionCredits("0x1");
    await api.getRelease("0x2");
    expect(calls[0]).toContain("/v1/compositions/0x1/credits?v=1700000000-deadbeef");
    expect(calls[1]).toContain("/v1/protocol/releases/0x2?v=1700000000-deadbeef");
    expect(initCalls[0]!.cache).toBe("no-store");
    expect(initCalls[1]!.cache).toBeUndefined();
  });

  test("forwards request options and distinguishes null, errors, and malformed bodies", async () => {
    const absent = stubFetch({ status: 404 });
    expect(await createMisoApiClient({ baseUrl: BASE, fetch: absent.fetch }).getRecordingMaster("0x1")).toBeNull();

    const attached = stubFetch({ body: { recordingId: "0x1", masterBlobId: null } });
    await expect(createMisoApiClient({ baseUrl: BASE, fetch: attached.fetch }).getRecordingMaster("0x1"))
      .resolves.toEqual({ recordingId: "0x1", masterBlobId: null });

    const failed = stubFetch({ status: 500, body: { error: { code: "upstream", message: "down" } } });
    await expect(createMisoApiClient({ baseUrl: BASE, fetch: failed.fetch }).getReleaseCore("0x1"))
      .rejects.toBeInstanceOf(MisoApiError);

    const malformed = stubFetch({ body: { releaseId: "0x1" } });
    await expect(createMisoApiClient({ baseUrl: BASE, fetch: malformed.fetch }).getReleaseCore("0x1"))
      .rejects.toBeInstanceOf(MisoApiContractError);
  });
});
