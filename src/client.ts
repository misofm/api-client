// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The typed client for the Miso read API. Every response is parsed at the
// boundary so API/client version skew fails loudly and locally.

import type { z } from "zod";
import * as s from "./schemas.js";
import { queryPolicy, type CacheClass } from "./cache.js";
import type {
  ArtistProfile,
  Balance,
  CompositionCore,
  CompositionCredits,
  CompositionLyricsResource,
  ListingView,
  OwnedParty,
  OwnedRecord,
  OwnedWork,
  Ownership,
  PartySummary,
  PendingMembership,
  PressingView,
  PurchaseReceipt,
  RecordAlbum,
  RecordingCore,
  RecordingCreditsResource,
  RecordingEngineSession,
  RecordingMasterResource,
  RecordingStream,
  ReleaseCore,
  ReleaseCover,
  ReleaseCredits,
  ReleaseDescription,
  ReleaseDetail,
  ReleaseGenres,
  ReleaseKind,
  ReleaseTracks,
  RoyaltyClaimsPage,
  RoyaltyStakesPage,
  WorkDetail,
  CompositionView,
  CompositionLyrics,
  RecordingView,
} from "./types.js";

export interface MisoRequestOptions {
  /** Cancels this request without affecting other calls made by the client. */
  signal?: AbortSignal;
  /** Additional request headers. `Accept: application/json` is supplied by default. */
  headers?: HeadersInit;
}

export interface MisoApiErrorOptions {
  requestId?: string;
  retryAfter?: number;
}

export class MisoApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Correlation id supplied by the API, when available. */
  readonly requestId?: string;
  /** Delay requested by `Retry-After`, normalized to seconds. */
  readonly retryAfter?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    metadata: MisoApiErrorOptions = {},
  ) {
    super(message);
    this.name = "MisoApiError";
    this.status = status;
    this.code = code;
    this.requestId = metadata.requestId;
    this.retryAfter = metadata.retryAfter;
  }
}

function errorMetadata(headers: Headers): MisoApiErrorOptions {
  const requestId = headers.get("X-Request-Id")?.trim() || undefined;
  const rawRetryAfter = headers.get("Retry-After")?.trim();
  if (!rawRetryAfter) return { requestId };

  const seconds = Number(rawRetryAfter);
  if (Number.isFinite(seconds) && seconds >= 0)
    return { requestId, retryAfter: seconds };

  const timestamp = Date.parse(rawRetryAfter);
  return Number.isFinite(timestamp)
    ? {
        requestId,
        retryAfter: Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)),
      }
    : { requestId };
}

/**
 * The server said something this client cannot describe. Distinct from
 * `MisoApiError`: this indicates API/client version skew rather than an
 * expected API outcome.
 */
export class MisoApiContractError extends Error {
  readonly issues: z.core.$ZodIssue[];
  /** Correlation id supplied by the API, when available. */
  readonly requestId?: string;

  constructor(
    path: string,
    issues: z.core.$ZodIssue[],
    metadata: MisoApiErrorOptions = {},
  ) {
    const first = issues[0];
    super(
      `Response from ${path} did not match the expected contract` +
        (first ? `: ${first.path.join(".")} — ${first.message}` : "") +
        ". The API and @misofm/api-client are likely different versions.",
    );
    this.name = "MisoApiContractError";
    this.issues = issues;
    this.requestId = metadata.requestId;
  }
}

export interface MisoApiClientOptions {
  /** Public API origin, e.g. `https://api.testnet.miso.fm`. */
  baseUrl: string;
  /**
   * Cache buster appended as `?v=` to mutable public reads only. A surface that
   * has just written something and must see its own change supplies a fresh
   * value here (see {@link cacheBuster}). Returning `undefined` sends no `v`.
   *
   * Private wallet reads and immutable receipts/base record-album reads ignore
   * this value: they are either not shared-cached or can never become fresher.
   */
  version?: () => string | undefined;
  /** Injectable for tests, Workers, and anything with its own fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Path the API endpoints are mounted under on `baseUrl`. The public gateway
   * uses `/v1`, followed by the protocol or platform resource namespace.
   */
  prefix?: string;
  /** Path the canonical modular resource endpoints are mounted under. */
  modularPrefix?: string;
}

export type WalletOwnershipTarget =
  | { partyId: string; recordId?: never }
  | { partyId?: never; recordId: string };

type QueryValue = string | number | boolean | undefined | null;

interface RequestConfig extends MisoRequestOptions {
  nullOn404?: boolean;
  /** Whether this public resource can change after it has first been read. */
  mutable?: boolean;
  /** Modular versioned reads bypass browser caches while propagating writes. */
  modular?: boolean;
}

/** Encode exactly one dynamic route segment, including `/`, `%`, `?`, and `#`. */
function segment(value: string): string {
  const encoded = encodeURIComponent(value);
  // WHATWG URL parsing treats literal and percent-encoded `.` / `..` as path
  // navigation. Double-encoding dot-only inputs keeps even hostile values in
  // the one dynamic segment where the caller supplied them.
  return encoded === "."
    ? "%252E"
    : encoded === ".."
      ? "%252E%252E"
      : encoded;
}

/** Add the default Accept header without requiring a global Headers constructor. */
function requestHeaders(input?: HeadersInit): HeadersInit {
  if (!input) return { Accept: "application/json" };

  const entries: [string, string][] = [];
  if (Array.isArray(input)) {
    for (const [name, value] of input) entries.push([name, value]);
  } else if (typeof (input as Headers).forEach === "function") {
    (input as Headers).forEach((value, name) => entries.push([name, value]));
  } else if (typeof (input as unknown as Iterable<readonly [string, string]>)[Symbol.iterator] === "function") {
    for (const [name, value] of input as unknown as Iterable<readonly [string, string]>) {
      entries.push([name, value]);
    }
  } else {
    entries.push(...Object.entries(input as Record<string, string>));
  }

  if (!entries.some(([name]) => name.toLowerCase() === "accept")) {
    entries.unshift(["Accept", "application/json"]);
  }
  return entries;
}

export function createMisoApiClient(options: MisoApiClientOptions) {
  const base = options.baseUrl.replace(/\/$/, "");
  const prefix = (options.prefix ?? "/v1").replace(/\/$/, "");
  const modularPrefix = (options.modularPrefix ?? "/v1").replace(/\/$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  function url(
    path: string,
    query: Record<string, QueryValue> = {},
    version?: string,
    root = prefix,
  ): string {
    const u = new URL(`${base}${root}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "")
        u.searchParams.set(key, String(value));
    }
    if (version) u.searchParams.set("v", version);
    return u.toString();
  }

  async function request<T>(
    schema: z.ZodType<T>,
    path: string,
    query: Record<string, QueryValue> = {},
    opts: RequestConfig = {},
  ): Promise<T | null> {
    const version = opts.mutable ? options.version?.() : undefined;
    const init: RequestInit = {
      headers: requestHeaders(opts.headers),
      signal: opts.signal,
    };
    if (opts.modular && version) init.cache = "no-store";
    const target = url(
      path,
      query,
      version,
      opts.modular ? modularPrefix : prefix,
    );
    const response = await doFetch(target, init);

    if (response.status === 404 && opts.nullOn404) return null;

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const parsed = s.apiErrorSchema.safeParse(body);
      const metadata = errorMetadata(response.headers);
      throw parsed.success
        ? new MisoApiError(
            response.status,
            parsed.data.error.code,
            parsed.data.error.message,
            metadata,
          )
        : new MisoApiError(
            response.status,
            "unknown",
            `Request to ${path} failed (${response.status})`,
            metadata,
          );
    }

    const json = await response.json().catch(() => {
      throw new MisoApiError(
        response.status,
        "bad_response",
        `Response from ${path} was not JSON`,
        errorMetadata(response.headers),
      );
    });

    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new MisoApiContractError(
        path,
        parsed.error.issues,
        errorMetadata(response.headers),
      );
    return parsed.data;
  }

  async function required<T>(
    schema: z.ZodType<T>,
    path: string,
    query?: Record<string, QueryValue>,
    opts?: RequestConfig,
  ): Promise<T> {
    return (await request(schema, path, query, opts)) as T;
  }

  // Each implementation is defined once so compatibility aliases cannot drift.
  const getPressing = (
    pressingId: string,
    opts: MisoRequestOptions = {},
  ): Promise<PressingView | null> =>
    request(s.pressingViewSchema, `/platform/pressings/${segment(pressingId)}`, {}, {
      ...opts,
      nullOn404: true,
      mutable: true,
    });

  const getPressingListing = (
    pressingId: string,
    currencyType: string,
    opts: MisoRequestOptions = {},
  ): Promise<ListingView | null> =>
    request(
      s.listingViewSchema,
      `/platform/pressings/${segment(pressingId)}/listing`,
      { currencyType },
      { ...opts, nullOn404: true, mutable: true },
    );

  const getComposition = (compositionId: string, opts: MisoRequestOptions = {}): Promise<CompositionView | null> =>
    request(s.compositionViewSchema, `/protocol/compositions/${segment(compositionId)}`, {}, {
      ...opts, nullOn404: true, mutable: true,
    });

  const getCompositionLyrics = (compositionId: string, opts: MisoRequestOptions = {}): Promise<CompositionLyrics | null> =>
    request(s.compositionLyricsSchema, `/protocol/compositions/${segment(compositionId)}/lyrics`, {}, {
      ...opts, nullOn404: true, mutable: true,
    });

  const getRecording = (recordingId: string, opts: MisoRequestOptions = {}): Promise<RecordingView | null> =>
    request(s.recordingViewSchema, `/protocol/recordings/${segment(recordingId)}`, {}, {
      ...opts, nullOn404: true, mutable: true,
    });

  const getRelease = (
    releaseId: string,
    opts: MisoRequestOptions & { include?: readonly "trackCredits"[] } = {},
  ): Promise<ReleaseDetail | null> =>
    request(
      s.releaseDetailSchema,
      `/protocol/releases/${segment(releaseId)}`,
      { include: opts.include?.join(",") },
      { ...opts, nullOn404: true, mutable: true },
    );

  const getCompositionCore = (
    compositionId: string,
    opts: MisoRequestOptions = {},
  ): Promise<CompositionCore | null> =>
    request(
      s.compositionCoreSchema,
      `/compositions/${segment(compositionId)}`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getCompositionCredits = (
    compositionId: string,
    opts: MisoRequestOptions = {},
  ): Promise<CompositionCredits | null> =>
    request(
      s.compositionCreditsSchema,
      `/compositions/${segment(compositionId)}/credits`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getCompositionLyricsResource = (
    compositionId: string,
    opts: MisoRequestOptions = {},
  ): Promise<CompositionLyricsResource | null> =>
    request(
      s.compositionLyricsResourceSchema,
      `/compositions/${segment(compositionId)}/lyrics`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getRecordingCore = (
    recordingId: string,
    opts: MisoRequestOptions = {},
  ): Promise<RecordingCore | null> =>
    request(
      s.recordingCoreSchema,
      `/recordings/${segment(recordingId)}`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getRecordingCredits = (
    recordingId: string,
    opts: MisoRequestOptions = {},
  ): Promise<RecordingCreditsResource | null> =>
    request(
      s.recordingCreditsResourceSchema,
      `/recordings/${segment(recordingId)}/credits`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getRecordingMaster = (
    recordingId: string,
    opts: MisoRequestOptions = {},
  ): Promise<RecordingMasterResource | null> =>
    request(
      s.recordingMasterResourceSchema,
      `/recordings/${segment(recordingId)}/master`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getRecordingStream = (
    recordingId: string,
    opts: MisoRequestOptions = {},
  ): Promise<RecordingStream | null> =>
    request(
      s.recordingStreamSchema,
      `/recordings/${segment(recordingId)}/stream`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getRecordingEngineSession = (
    recordingId: string,
    opts: MisoRequestOptions = {},
  ): Promise<RecordingEngineSession | null> =>
    request(
      s.recordingEngineSessionSchema,
      `/recordings/${segment(recordingId)}/engine-session`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getReleaseCore = (
    releaseId: string,
    opts: MisoRequestOptions = {},
  ): Promise<ReleaseCore | null> =>
    request(
      s.releaseCoreSchema,
      `/releases/${segment(releaseId)}`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getReleaseTracks = (
    releaseId: string,
    opts: MisoRequestOptions = {},
  ): Promise<ReleaseTracks | null> =>
    request(
      s.releaseTracksSchema,
      `/releases/${segment(releaseId)}/tracks`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getReleaseCredits = (
    releaseId: string,
    opts: MisoRequestOptions = {},
  ): Promise<ReleaseCredits | null> =>
    request(
      s.releaseCreditsSchema,
      `/releases/${segment(releaseId)}/credits`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getReleaseCover = (
    releaseId: string,
    opts: MisoRequestOptions = {},
  ): Promise<ReleaseCover | null> =>
    request(
      s.releaseCoverSchema,
      `/releases/${segment(releaseId)}/cover`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getReleaseKind = (
    releaseId: string,
    opts: MisoRequestOptions = {},
  ): Promise<ReleaseKind | null> =>
    request(
      s.releaseKindSchema,
      `/releases/${segment(releaseId)}/kind`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getReleaseDescription = (
    releaseId: string,
    opts: MisoRequestOptions = {},
  ): Promise<ReleaseDescription | null> =>
    request(
      s.releaseDescriptionSchema,
      `/releases/${segment(releaseId)}/description`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getReleaseGenres = (
    releaseId: string,
    opts: MisoRequestOptions = {},
  ): Promise<ReleaseGenres | null> =>
    request(
      s.releaseGenresSchema,
      `/releases/${segment(releaseId)}/genres`,
      {},
      { ...opts, nullOn404: true, mutable: true, modular: true },
    );

  const getRecordAlbum = (
    recordId: string,
    opts: MisoRequestOptions & {
      include?: readonly ("release" | "trackCredits")[];
    } = {},
  ): Promise<RecordAlbum | null> =>
    request(
      s.recordAlbumSchema,
      `/platform/records/${segment(recordId)}/album`,
      { include: opts.include?.join(",") },
      {
        ...opts,
        nullOn404: true,
        // The relation is immutable; expanded release metadata can change.
        mutable: (opts.include?.length ?? 0) > 0,
      },
    );

  const getArtist = (
    partyId: string,
    opts: MisoRequestOptions & {
      include?: readonly ("roles" | "tags")[];
    } = {},
  ): Promise<ArtistProfile | null> =>
    request(
      s.artistProfileSchema,
      `/platform/artists/${segment(partyId)}`,
      { include: opts.include?.join(",") },
      { ...opts, nullOn404: true, mutable: true },
    );

  const listArtists = (
    ids: readonly string[],
    opts: MisoRequestOptions = {},
  ): Promise<PartySummary[]> =>
    ids.length === 0
      ? Promise.resolve([])
      : required(s.partySummariesSchema, "/platform/artists", { ids: ids.join(",") }, {
          ...opts,
          mutable: true,
        });

  const listWalletRecords = (
    address: string,
    opts: MisoRequestOptions = {},
  ): Promise<OwnedRecord[]> =>
    required(s.ownedRecordsSchema, `/platform/wallets/${segment(address)}/records`, {}, opts);

  const listWalletParties = (
    address: string,
    opts: MisoRequestOptions = {},
  ): Promise<OwnedParty[]> =>
    required(s.ownedPartiesSchema, `/platform/wallets/${segment(address)}/parties`, {}, opts);

  /**
   * The wallet's royalty claim transactions, newest first, one page at a time.
   * Pass a page's `nextCursor` as `before` for the next (older) page. The event
   * index behind this keeps a bounded window; `availableFromMs` says how far
   * back it reaches.
   */
  const listWalletStakes = (
    address: string,
    page: { cursor?: string | null; limit?: number; include?: readonly "work"[] } = {},
    opts: MisoRequestOptions = {},
  ): Promise<RoyaltyStakesPage> =>
    required(s.royaltyStakesPageSchema, `/protocol/wallets/${segment(address)}/stakes`,
      { cursor: page.cursor ?? undefined, limit: page.limit, include: page.include?.join(",") }, opts);

  const listWalletRoyaltyClaims = (
    address: string,
    page: { before?: string | null; limit?: number } = {},
    opts: MisoRequestOptions = {},
  ): Promise<RoyaltyClaimsPage> =>
    required(
      s.royaltyClaimsPageSchema,
      `/protocol/wallets/${segment(address)}/royalty-claims`,
      { before: page.before ?? undefined, limit: page.limit },
      opts,
    );

  const listWalletPendingMemberships = (
    address: string,
    opts: MisoRequestOptions = {},
  ): Promise<PendingMembership[]> =>
    required(
      s.pendingMembershipsSchema,
      `/platform/wallets/${segment(address)}/pending-memberships`,
      {},
      opts,
    );

  const listWalletWorks = (
    address: string,
    opts: MisoRequestOptions = {},
  ): Promise<OwnedWork[]> =>
    required(s.ownedWorksSchema, `/protocol/wallets/${segment(address)}/works`, {}, opts);

  const getWork = (
    capId: string,
    opts: MisoRequestOptions = {},
  ): Promise<WorkDetail | null> =>
    request(s.workDetailSchema, `/protocol/work-capabilities/${segment(capId)}/work`, {}, {
      ...opts,
      nullOn404: true,
    });

  /** One snapshot-consistent read of every work administered by a wallet. */
  const listWalletWorkDetails = (
    address: string,
    opts: MisoRequestOptions = {},
  ): Promise<WorkDetail[]> =>
    required(
      s.workDetailsSchema,
      `/protocol/wallets/${segment(address)}/work-details`,
      {},
      opts,
    );

  const getWalletBalance = (
    address: string,
    coinType?: string,
    opts: MisoRequestOptions = {},
  ): Promise<Balance> =>
    required(
      s.balanceSchema,
      `/platform/wallets/${segment(address)}/balance`,
      { coinType },
      opts,
    );

  const getWalletPartyOwnership = (
    address: string,
    partyId: string,
    opts: MisoRequestOptions = {},
  ): Promise<Ownership> =>
    required(
      s.ownershipSchema,
      `/platform/wallets/${segment(address)}/ownership`,
      { party: partyId },
      opts,
    );

  const getWalletOwnership = (
    address: string,
    target: WalletOwnershipTarget,
    opts: MisoRequestOptions = {},
  ): Promise<Ownership> =>
    required(
      s.ownershipSchema,
      `/platform/wallets/${segment(address)}/ownership`,
      {
        party: target.partyId,
        record: target.recordId,
      },
      opts,
    );

  const getWalletRecordOwnership = (
    address: string,
    recordId: string,
    opts: MisoRequestOptions = {},
  ): Promise<Ownership> =>
    required(
      s.ownershipSchema,
      `/platform/wallets/${segment(address)}/ownership`,
      { record: recordId },
      opts,
    );

  const getPurchaseReceipt = (
    txDigest: string,
    recordId: string,
    opts: MisoRequestOptions = {},
  ): Promise<PurchaseReceipt | null> =>
    request(
      s.purchaseReceiptSchema,
      `/platform/transactions/${segment(txDigest)}/receipts/${segment(recordId)}`,
      {},
      { ...opts, nullOn404: true },
    );

  return {
    getComposition,
    getCompositionLyrics,
    getRecording,
    getCompositionCore,
    getCompositionCredits,
    getCompositionLyricsResource,
    getRecordingCore,
    getRecordingCredits,
    getRecordingMaster,
    getRecordingStream,
    getRecordingEngineSession,
    getReleaseCore,
    getReleaseTracks,
    getReleaseCredits,
    getReleaseCover,
    getReleaseKind,
    getReleaseDescription,
    getReleaseGenres,
    getPressing,
    getPressingListing,
    getRelease,
    getRecordAlbum,
    getArtist,
    listArtists,
    listWalletRecords,
    listWalletRoyaltyClaims,
    listWalletStakes,
    listWalletParties,
    listWalletPendingMemberships,
    listWalletWorks,
    getWork,
    listWalletWorkDetails,
    getWalletBalance,
    getWalletOwnership,
    getWalletPartyOwnership,
    getWalletRecordOwnership,
    getPurchaseReceipt,

    /** @deprecated Use {@link getPressingListing}. */
    getListing: getPressingListing,
    /** @deprecated Use {@link listArtists}. */
    getArtists: listArtists,
    /** @deprecated Use {@link listWalletRecords}. */
    getWalletRecords: listWalletRecords,
    /** @deprecated Use {@link listWalletParties}. */
    getWalletParties: listWalletParties,
    /** @deprecated Use {@link listWalletPendingMemberships}. */
    getPendingMemberships: listWalletPendingMemberships,
    /** @deprecated Use {@link listWalletWorks}. */
    getWalletWorks: listWalletWorks,
    /** @deprecated Use {@link listWalletWorkDetails}. */
    getWalletWorkDetails: listWalletWorkDetails,
    /** @deprecated Use {@link getWalletBalance}. */
    getBalance: getWalletBalance,
    /** @deprecated Use {@link getWalletPartyOwnership}. */
    ownsParty: getWalletPartyOwnership,
    /** @deprecated Use {@link getWalletRecordOwnership}. */
    ownsRecord: getWalletRecordOwnership,

  };
}

export type MisoApiClient = ReturnType<typeof createMisoApiClient>;

/**
 * A cache-buster value for {@link MisoApiClientOptions.version}.
 *
 * Call this once after a write lands on-chain, retain the returned value, and
 * use it for the writer's subsequent mutable public reads. The timestamp keeps
 * the bypass bounded; the random nonce prevents an attacker from pre-filling
 * the exact URL before the writer reaches it.
 */
export function cacheBuster(
  nowMs: number = Date.now(),
  nonce: string = crypto.getRandomValues(new Uint32Array(1))[0]!
    .toString(16)
    .padStart(8, "0"),
): string {
  if (!/^[0-9a-fA-F]{8}$/.test(nonce)) {
    throw new RangeError("cacheBuster nonce must be exactly 8 hexadecimal characters.");
  }
  return `${Math.floor(nowMs / 1000)}-${nonce.toLowerCase()}`;
}

/**
 * Static cache classes for callers aligning their query options with the edge.
 * `getRelease` is response-dependent and therefore absent. `getRecordAlbum`
 * describes only the unexpanded base response; use `recordAlbumQueryPolicy`
 * when requesting relationship expansions.
 *
 * Legacy keys remain for source compatibility with existing applications.
 */
export const READ_CACHE_CLASS = {
  getPressing: "sale",
  getPressingListing: "sale",
  getListing: "sale",
  getRecordAlbum: "immutable",
  getPurchaseReceipt: "immutable",
  getReceipt: "immutable",
  getArtist: "artist",
  listArtists: "artist",
  getArtists: "artist",
  listWalletRecords: "private",
  listWalletRoyaltyClaims: "private",
  listWalletStakes: "private",
  getWalletRecords: "private",
  listWalletParties: "private",
  getWalletParties: "private",
  listWalletPendingMemberships: "private",
  getPendingMemberships: "private",
  listWalletWorks: "private",
  getWalletWorks: "private",
  getWork: "private",
  listWalletWorkDetails: "private",
  getWalletWorkDetails: "private",
  getWalletBalance: "private",
  getBalance: "private",
  getWalletOwnership: "private",
  getWalletPartyOwnership: "private",
  ownsParty: "private",
  getWalletRecordOwnership: "private",
  ownsRecord: "private",
} as const satisfies Record<string, CacheClass>;

export { queryPolicy };
