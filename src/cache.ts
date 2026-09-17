// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How long each kind of read stays good. ONE table, shared by both ends:
//
//   miso-read-service  turns a class into `Cache-Control` and a Cache API entry
//   this client        turns the same class into a TanStack Query `staleTime`
//
// They live together because a client that refetches every 30s in front of an
// edge that caches for 60s is just serving itself the cached body twice. Reading
// the same numbers keeps the browser's idea of "fresh" and the edge's identical.
//
// The classes are chosen by WHAT MOVES THE DATA, not by route:
//
//   immutable   nothing can change it, ever. A record's parent release is fixed
//               at mint; a settled transaction is settled. Cache for a year.
//   published   a published work. Its metadata only moves when an artist
//               deliberately re-sets an extension — rare, and a minute of
//               staleness costs nobody anything.
//   draft       the same work before publication: actively being edited in
//               studio, so the editor must see their own change land.
//   artist      a profile page. Owner edits should surface within a minute.
//   sale        a Pressing or Listing. Supply, authorization, pricing, and the
//               listing switch can move, so clients refresh them quickly. The chain remains the
//               purchase gate when an edge response is briefly stale.
//   private     address-scoped. Never enters a shared cache — the failure mode is
//               serving one user's library to another.
//
// THERE IS NO INVALIDATION. These TTLs are the whole freshness story: the cache
// is an optimization, never a source of truth, and the chain stays
// authoritative. A writer who must see their OWN change immediately appends a
// cache-buster param, which takes a bounded no-store path instead of evicting
// the entry everybody else is reading.

export type CacheClass = "immutable" | "published" | "draft" | "artist" | "sale" | "private";

export interface CachePolicy {
  /** Shared-cache lifetime in seconds (`s-maxage`). `null` for private. */
  sMaxAge: number | null;
  /**
   * How long past `sMaxAge` the edge may serve the stale body while it
   * revalidates behind the request. This is where the latency win lives: a
   * visitor after expiry gets the old body instantly instead of waiting on a
   * chain round-trip.
   */
  staleWhileRevalidate: number | null;
  /** Browser lifetime (`max-age`). Deliberately shorter than the edge's. */
  maxAge: number;
  /** TanStack Query `staleTime`, in ms. Mirrors `maxAge`. */
  staleTimeMs: number;
}

export const CACHE_POLICIES: Record<CacheClass, CachePolicy> = {
  immutable: { sMaxAge: 31_536_000, staleWhileRevalidate: null, maxAge: 31_536_000, staleTimeMs: Number.POSITIVE_INFINITY },
  published: { sMaxAge: 3_600, staleWhileRevalidate: 86_400, maxAge: 300, staleTimeMs: 300_000 },
  draft: { sMaxAge: 60, staleWhileRevalidate: 300, maxAge: 0, staleTimeMs: 0 },
  artist: { sMaxAge: 60, staleWhileRevalidate: 600, maxAge: 30, staleTimeMs: 30_000 },
  sale: { sMaxAge: 60, staleWhileRevalidate: 300, maxAge: 0, staleTimeMs: 0 },
  private: { sMaxAge: null, staleWhileRevalidate: null, maxAge: 0, staleTimeMs: 0 },
};

/**
 * The complete historical `Cache-Control` policy for a class.
 *
 * `private, no-store` on the private class is doing real work: `private` alone
 * would still let a browser (or a misconfigured intermediary) retain the body,
 * and these responses describe one wallet's holdings.
 */
export function cacheControl(cls: CacheClass): string {
  const p = CACHE_POLICIES[cls];
  if (p.sMaxAge === null) return "private, no-store";

  const parts = ["public", `max-age=${p.maxAge}`, `s-maxage=${p.sMaxAge}`];
  if (p.staleWhileRevalidate !== null) {
    parts.push(`stale-while-revalidate=${p.staleWhileRevalidate}`);
  }
  if (cls === "immutable") parts.push("immutable");
  return parts.join(", ");
}

/** Browser-only policy used when an edge-specific header is emitted beside it. */
export function browserCacheControl(cls: CacheClass): string {
  const p = CACHE_POLICIES[cls];
  if (p.sMaxAge === null) return "private, no-store";

  const parts = ["public", `max-age=${p.maxAge}`];
  if (cls === "immutable") parts.push("immutable");
  return parts.join(", ");
}

/**
 * Cloudflare's edge-only cache policy.
 *
 * Cloudflare disables stale-while-revalidate when `s-maxage` is present, so
 * the CDN-specific header uses `max-age` for the shared lifetime. It does not
 * reach browsers; their shorter policy remains in {@link browserCacheControl}.
 */
export function cdnCacheControl(cls: CacheClass): string | null {
  const p = CACHE_POLICIES[cls];
  if (p.sMaxAge === null) return null;

  const parts = ["public", `max-age=${p.sMaxAge}`];
  if (p.staleWhileRevalidate !== null) {
    parts.push(`stale-while-revalidate=${p.staleWhileRevalidate}`);
  }
  if (cls === "immutable") parts.push("immutable");
  return parts.join(", ");
}

/** TanStack Query options for a class — spread straight into `useQuery`. */
export function queryPolicy(cls: CacheClass): { staleTime: number } {
  return { staleTime: CACHE_POLICIES[cls].staleTimeMs };
}

/**
 * A work's class from its own state. This is why the middleware picks TTL from
 * the RESPONSE rather than the route: the same `/protocol/releases/:id` path is a
 * year-stable published record for one id and a live draft for another.
 */
export function workCacheClass(state: { type: string } | null | undefined): CacheClass {
  return state?.type === "Published" ? "published" : "draft";
}

export interface RecordAlbumCacheOptions {
  include?: readonly ("release" | "trackCredits")[];
}

export interface RecordAlbumCacheValue {
  release?: { state: { type: string } } | null;
}

/**
 * Cache class for a record-album response.
 *
 * The bare `recordId -> releaseId` relation is fixed at mint and immutable.
 * Asking for either expansion embeds release metadata that can still move; its
 * response state then selects the same published/draft policy as `getRelease`.
 * Missing expanded data fails toward freshness rather than being cached for a
 * year under a misleading immutable label.
 */
export function recordAlbumCacheClass(
  album: RecordAlbumCacheValue | null | undefined,
  options: RecordAlbumCacheOptions = {},
): CacheClass {
  if ((options.include?.length ?? 0) === 0) return "immutable";
  return workCacheClass(album?.release?.state);
}

/** Response/options-aware TanStack Query policy for `getRecordAlbum`. */
export function recordAlbumQueryPolicy(
  album: RecordAlbumCacheValue | null | undefined,
  options: RecordAlbumCacheOptions = {},
): { staleTime: number } {
  return queryPolicy(recordAlbumCacheClass(album, options));
}
