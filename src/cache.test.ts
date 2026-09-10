// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cache table is a policy document that happens to be executable, so it gets
// tested as one: the exact header per class, and the invariants that make the
// classes coherent with each other.

import { describe, expect, test } from "bun:test";
import {
  CACHE_POLICIES,
  browserCacheControl,
  cacheControl,
  cdnCacheControl,
  recordAlbumCacheClass,
  recordAlbumQueryPolicy,
  workCacheClass,
  type CacheClass,
} from "./cache.js";

describe("cacheControl", () => {
  const expected: Record<CacheClass, string> = {
    immutable: "public, max-age=31536000, s-maxage=31536000, immutable",
    published: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    draft: "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    artist: "public, max-age=30, s-maxage=60, stale-while-revalidate=600",
    sale: "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    private: "private, no-store",
  };

  for (const [cls, header] of Object.entries(expected)) {
    test(`${cls} → ${header}`, () => {
      expect(cacheControl(cls as CacheClass)).toBe(header);
    });
  }

  test("private never reaches a shared cache", () => {
    const header = cacheControl("private");
    expect(header).not.toContain("public");
    expect(header).not.toContain("s-maxage");
    expect(header).toContain("no-store");
  });

  test("offers a browser-only companion without changing the legacy helper", () => {
    expect(browserCacheControl("published")).toBe("public, max-age=300");
    expect(browserCacheControl("private")).toBe("private, no-store");
  });

  test("puts edge freshness and working SWR in Cloudflare's CDN-only header", () => {
    expect(cdnCacheControl("published")).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    expect(cdnCacheControl("private")).toBeNull();
    expect(cdnCacheControl("published")).not.toContain("s-maxage");
  });
});

describe("policy invariants", () => {
  const publicClasses = (Object.keys(CACHE_POLICIES) as CacheClass[]).filter((c) => c !== "private");

  test("the edge always holds a response at least as long as a browser does", () => {
    // Otherwise the browser outlives the shared copy and the edge cache is
    // pointless — every client revalidation would miss.
    for (const cls of publicClasses) {
      const p = CACHE_POLICIES[cls];
      expect(p.sMaxAge!).toBeGreaterThanOrEqual(p.maxAge);
    }
  });

  test("staleTime mirrors the browser lifetime, so the client never refetches what it already holds fresh", () => {
    for (const cls of publicClasses) {
      const p = CACHE_POLICIES[cls];
      if (Number.isFinite(p.staleTimeMs)) expect(p.staleTimeMs).toBe(p.maxAge * 1000);
    }
    expect(CACHE_POLICIES.immutable.staleTimeMs).toBe(Number.POSITIVE_INFINITY);
  });

  test("live sale data is among the shortest public TTLs", () => {
    // No longer strictly the shortest: a pressing is UNCAPPED, so its
    // copies-sold counter gates nothing and a minute of staleness is cosmetic.
    // `draft` now ties it, because an editor really must see their own change.
    const others = publicClasses.filter((c) => c !== "sale");
    for (const cls of others) {
      expect(CACHE_POLICIES.sale.sMaxAge!).toBeLessThanOrEqual(CACHE_POLICIES[cls].sMaxAge!);
    }
  });

  test("a draft is cached far more briefly than a published work", () => {
    expect(CACHE_POLICIES.draft.sMaxAge!).toBeLessThan(CACHE_POLICIES.published.sMaxAge!);
    // An editor must see their own change land.
    expect(CACHE_POLICIES.draft.maxAge).toBe(0);
  });

  test("private carries no shared lifetime at all", () => {
    expect(CACHE_POLICIES.private.sMaxAge).toBeNull();
    expect(CACHE_POLICIES.private.staleWhileRevalidate).toBeNull();
    expect(CACHE_POLICIES.private.staleTimeMs).toBe(0);
  });
});

describe("workCacheClass", () => {
  test("published work caches long, draft caches short", () => {
    expect(workCacheClass({ type: "Published" })).toBe("published");
    expect(workCacheClass({ type: "Initialized" })).toBe("draft");
  });

  test("an unknown or missing state is treated as a draft", () => {
    // Fail toward freshness: over-caching a work that is still moving is the
    // worse error, because the artist edits and nothing happens.
    expect(workCacheClass(null)).toBe("draft");
    expect(workCacheClass(undefined)).toBe("draft");
  });
});

describe("wallet work details cache policy", () => {
  test("uses the private policy for the bulk wallet read", () => {
    expect(CACHE_POLICIES["private"].staleTimeMs).toBe(0);
    expect(cacheControl("private")).toBe("private, no-store");
  });
});

describe("recordAlbum cache policy", () => {
  test("the unexpanded record-to-release relation is immutable", () => {
    expect(recordAlbumCacheClass({})).toBe("immutable");
    expect(recordAlbumQueryPolicy({}).staleTime).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("expanded metadata follows the release state", () => {
    const published = { release: { state: { type: "Published" } } };
    const draft = { release: { state: { type: "Initialized" } } };
    const options = { include: ["release"] as const };
    expect(recordAlbumCacheClass(published, options)).toBe("published");
    expect(recordAlbumCacheClass(draft, options)).toBe("draft");
    expect(recordAlbumQueryPolicy(published, options)).toEqual({
      staleTime: CACHE_POLICIES.published.staleTimeMs,
    });
  });

  test("missing expanded release data fails toward freshness", () => {
    expect(
      recordAlbumCacheClass(null, { include: ["trackCredits"] }),
    ).toBe("draft");
  });
});
