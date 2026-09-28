import { describe, expect, test } from "bun:test";
import {
  MODULAR_CACHE_POLICIES,
  modularBrowserCacheControl,
  modularCachePolicy,
  modularEdgeCacheControl,
  modularQueryPolicy,
  type ModularResourceClass,
} from "./cache.js";

describe("modular cache policy", () => {
  test("uses the shared six-case policy table", () => {
    expect(MODULAR_CACHE_POLICIES["published-core"]).toEqual({
      browserMaxAge: 300,
      edgeMaxAge: 3600,
      staleWhileRevalidate: 86400,
    });
    expect(MODULAR_CACHE_POLICIES["draft-attachment"]).toEqual({
      browserMaxAge: 0,
      edgeMaxAge: 60,
      staleWhileRevalidate: null,
    });
  });

  test("normalizes work state and renders both headers", () => {
    const policy = modularCachePolicy({ type: "Published" }, "core");
    expect(policy).toEqual(MODULAR_CACHE_POLICIES["published-core"]);
    expect(modularBrowserCacheControl(policy)).toBe("public, max-age=300");
    expect(modularEdgeCacheControl(policy)).toBe("public, max-age=3600, stale-while-revalidate=86400");
    expect(modularEdgeCacheControl(modularCachePolicy("draft", "attachment"))).toBe("public, max-age=60");
  });

  for (const resource of ["core", "metadata", "attachment"] as ModularResourceClass[]) {
    test(`unknown or versioned ${resource} reads are immediately stale`, () => {
      expect(modularQueryPolicy(undefined, resource)).toEqual({ staleTime: 0 });
      expect(modularQueryPolicy(null, resource)).toEqual({ staleTime: 0 });
      expect(modularQueryPolicy("published", resource, { versioned: true })).toEqual({ staleTime: 0 });
    });
  }

  test("published freshness mirrors browser lifetime", () => {
    expect(modularQueryPolicy("published", "core")).toEqual({ staleTime: 300000 });
    expect(modularQueryPolicy("published", "metadata")).toEqual({ staleTime: 30000 });
    expect(modularQueryPolicy("published", "attachment")).toEqual({ staleTime: 0 });
  });
});
