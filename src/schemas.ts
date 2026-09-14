// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The response contract for every Miso read. This file is the SOURCE OF TRUTH:
//
//   · @misofm/api-client infers its types from it
//   · miso-read-service generates its OpenAPI document from it
//   · a contract test in that service parses every handler's real output through
//     it, so missing, renamed, or mistyped fields fail CI rather than reaching a
//     client. Additive fields remain forward-compatible and are stripped until
//     the public schema adopts them.
//
// Schemas, not hand-written interfaces, precisely so that third clause is
// possible. The CLI and any future client read the same OpenAPI.
//
// SCALARS: every u64/u128 is a DECIMAL STRING (`u64Schema`), never a number.
// Prices, balances, and purchase timestamps must remain lossless. Move u16/u32
// values are JSON numbers because their complete ranges fit safely in JavaScript.

import { z } from "zod";

/** A u64/u128 in base units, as a decimal string. See the file header. */
export const u64Schema = z
  .string()
  .regex(/^\d+$/, "expected a decimal integer string");

/** A Move u16 represented losslessly as a JSON number. */
export const u16Schema = z.number().int().min(0).max(0xffff);

/** A Move u32 represented losslessly as a JSON number. */
export const u32Schema = z.number().int().min(0).max(0xffff_ffff);

/** A 0x-prefixed 32-byte Sui object id or address, in canonical form. */
export const suiIdSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/, "expected a Sui object id");

/** A 32-byte Walrus blob id encoded as URL-safe, unpadded base64. */
export const walrusBlobIdSchema = z
  .string()
  // A 32-byte value has four meaningful bits in its final base64url character;
  // requiring the two padding bits to be zero rejects non-canonical aliases.
  .regex(
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,
    "expected a canonical Walrus blob id",
  );

// ── Shared ───────────────────────────────────────────────────────────────────

export const workStateSchema = z.union([
  z.object({ type: z.literal("Initialized") }),
  z.object({ type: z.literal("Published"), timestampMs: z.number().int() }),
]);

/** Blob references are canonical. The URL branch accepts responses cached before the cutover. */
export const coverImageSchema = z.union([
  z.object({ kind: z.literal("blob"), blobId: walrusBlobIdSchema }),
  z.object({ kind: z.enum(["blob", "quiltPatch"]), url: z.string().url() }),
]);

const bytesSchema = z.array(z.number().int().min(0).max(255));
/** Complete on-chain Audio payload, preserving decimal integers and confidentiality. */
export const recordingMasterSchema = z.object({
  format: z.string(),
  channels: z.number().int().min(0).max(255),
  bit_depth: z.number().int().min(0).max(255),
  sample_rate_hz: z.number().int().nonnegative(),
  samples: z.string().regex(/^[0-9]+$/),
  pcm_digest: bytesSchema,
  data: z.object({
    blob_id: z.string().regex(/^[0-9]+$/),
    confidentiality: z.union([
      z.object({ $kind: z.literal("Unencrypted"), Unencrypted: z.literal(true) }),
      z.object({ $kind: z.literal("Encrypted"), Encrypted: z.object({ sealed_dek: bytesSchema }) }),
    ]),
  }),
});

export const coverSchema = z.object({
  still: coverImageSchema,
  animated: coverImageSchema.nullable(),
});

export const creditSchema = z.object({
  partyId: suiIdSchema,
  displayName: z.string(),
  roles: z.array(z.string()),
});

/** A canonical-PCM stem digest (engine STEM_IDENTITY_V1) as 64 lowercase hex chars. */
export const stemDigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected a lowercase SHA-256 hex digest");

/** A track's on-chain Miso Engine session: the Session V1 blob and one FLAC blob per source. */
export const trackEngineSessionSchema = z.object({
  sessionBlobId: walrusBlobIdSchema,
  /** Sorted by digest, as stored on chain; `digest` equals the session source's `content` without `sha256:`. */
  stems: z.array(z.object({ digest: stemDigestSchema, blobId: walrusBlobIdSchema })),
});

/** Full core recording object. Audio attachments are exposed on the track. */
export const recordingViewSchema = z.object({
  /** Canonical recording share type; optional for cached responses. */
  shareType: z.string().optional(),
  id: suiIdSchema,
  state: workStateSchema,
  compositionId: suiIdSchema,
});

export const compositionViewSchema = z.object({
  id: suiIdSchema,
  state: workStateSchema,
  title: z.string(),
  royaltyRate: z.object({ value: z.number().int().min(0).max(10_000) }),
});

export const trackViewSchema = z.object({
  /** Display number — "1", or "1.2" (disc.track) on a multi-disc set. */
  no: z.string(),
  title: z.string(),
  recording: recordingViewSchema,
  composition: compositionViewSchema,
  /** This track's share of the release's revenue, in basis points. */
  splitBps: z.number().int().min(0).max(10_000),
  disc: z.number().int().min(1),
  /** Archival master attached through recording_master_reference, when present. */
  master: recordingMasterSchema.optional(),
  masterBlobId: walrusBlobIdSchema.optional(),
  /**
   * The `miso-hls/v1` streaming transcode Quilt attached through
   * recording_streaming_transcode, when present. The playback key: the master
   * playlist is `<aggregator>/v1/blobs/by-quilt-id/<id>/master.m3u8`.
   */
  transcodeQuiltId: walrusBlobIdSchema.optional(),
  /** The Miso Engine session attached through recording_engine_session, when present. */
  engineSession: trackEngineSessionSchema.optional(),
  /**
   * Encrypted mix delivery descriptor attached to this release track, when present.
   *
   * This is a discovery hint. A client using it for protected playback must compare
   * it with the authoritative release-track reference on Sui before trusting the
   * descriptor or requesting a Seal key.
   */
  mixBlobId: walrusBlobIdSchema
    .describe(
      "Discovery hint only. Before Walrus or Seal use, compare this blob ID with the authoritative release-track reference read directly from Sui.",
    )
    .optional(),
});

/** A recording's work-role credits and recording billing positions. */
export const recordingCreditsSchema = z.object({
  credits: z.array(creditSchema),
  primaryArtistIds: z.array(suiIdSchema),
  featuredArtistIds: z.array(suiIdSchema),
});

/** Per-track credits for a release. Composition writing and recording
 * performance/production credits remain separate. */
const completeTrackCreditsSchema = z.object({
  compositionCredits: z.array(creditSchema),
  recordingCredits: recordingCreditsSchema,
});

/** The HTTP wire accepts the complete shape and the deployed recording-only shape. */
export const trackCreditsWireSchema = z.union([
  completeTrackCreditsSchema,
  recordingCreditsSchema,
]);

/** Clients always receive the complete shape, including during the rollout. */
export const trackCreditsSchema = trackCreditsWireSchema.transform((credits) =>
  "recordingCredits" in credits
    ? credits
    : { compositionCredits: [], recordingCredits: credits },
);

// ── Catalog ──────────────────────────────────────────────────────────────────

const releaseDetailBaseSchema = z.object({
  id: suiIdSchema,
  title: z.string(),
  description: z.string().nullable().default(null),
  subtitle: z.string().nullable(),
  /** Self-declared `release_kind`, or null when the extension is absent. */
  kind: z.string().nullable(),
  state: workStateSchema,
  publishedAtMs: z.number().int().nullable(),
  cover: coverSchema.nullable(),
  credits: z.array(creditSchema),
  /** The release's primary artists in chain order — its artist line. */
  primaryArtists: z.array(z.string()),
  /** Ordered display names, primary genre first. Defaults for older API responses. */
  genres: z.array(z.string()).default([]),
  discCount: z.number().int().min(0),
  tracks: z.array(trackViewSchema),
});

/** Transform-free wire form used by OpenAPI generation. */
export const releaseDetailWireSchema = releaseDetailBaseSchema.extend({
  trackCredits: z.record(suiIdSchema, trackCreditsWireSchema).optional(),
});

export const releaseDetailSchema = releaseDetailBaseSchema.extend({
  /** Present only when requested via `include`. */
  trackCredits: z.record(suiIdSchema, trackCreditsSchema).optional(),
});

export const priceSchema = z.object({
  /** `fixed` — pay exactly this. `floor` — pay at least this. */
  kind: z.enum(["fixed", "floor"]),
  amount: u64Schema,
});

export const currencySchema = z.object({
  type: z.string().nullable(),
  symbol: z.string(),
  decimals: z.number().int().min(0).max(18),
});

export const pressingViewSchema = z.object({
  id: suiIdSchema,
  releaseId: suiIdSchema,
  /** Non-zero edition within this release. */
  edition: u16Schema.min(1),
  /** Records minted so far in this edition. */
  supply: u32Schema,
  /** Edition cap, or null for an uncapped pressing. */
  maxSupply: u32Schema.min(1).nullable(),
  /** Fully-qualified distributor Witness type names authorized to mint. */
  distributors: z.array(z.string().min(1)),
});

export const listingViewSchema = z.object({
  id: suiIdSchema,
  pressingId: suiIdSchema,
  releaseId: suiIdSchema,
  pricing: priceSchema,
  currency: currencySchema,
  state: z.enum(["enabled", "disabled"]),
});

export const pressingDetailSchema = z.object({
  pressing: pressingViewSchema,
  release: releaseDetailSchema,
});

export const pressingDetailWireSchema = z.object({
  pressing: pressingViewSchema,
  release: releaseDetailWireSchema,
});

export const recordAlbumSchema = z.object({
  recordId: suiIdSchema,
  releaseId: suiIdSchema.nullable(),
  /** Present only when requested via `include`. */
  release: releaseDetailSchema.nullable().optional(),
});

export const recordAlbumWireSchema = z.object({
  recordId: suiIdSchema,
  releaseId: suiIdSchema.nullable(),
  release: releaseDetailWireSchema.nullable().optional(),
});

// ── Artist ───────────────────────────────────────────────────────────────────

export const partyMemberSchema = z.object({
  id: suiIdSchema,
  name: z.string(),
});

/**
 * Every external platform the party link extensions know how to build a URL for,
 * spanning social, music, and professional payloads. Enumerated rather than left
 * as `string` so a renderer's icon/label switch is exhaustive at compile time —
 * adding a platform on-chain should break the UI that has no icon for it.
 */
export const platformKeySchema = z.enum([
  // Social (party_social)
  "x",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "discord",
  "telegram",
  "reddit",
  "twitch",
  "facebook",
  // Music (party_music)
  "spotify",
  "bandcamp",
  "soundcloud",
  "appleMusic",
  "deezer",
  "tidal",
  "amazonMusic",
  "audiomack",
  // Professional / industry (party_pro_link)
  "website",
  "bookingPage",
  "managementPage",
  "publisherPage",
  "labelPage",
  "epk",
  "patreon",
  "substack",
  "kofi",
]);

export const partyLinkSchema = z.object({
  platform: platformKeySchema,
  /** The platform-native identifier stored on-chain (handle / id / subdomain / URL). */
  value: z.string(),
  /** The public profile URL, rebuilt client-side from `value`. */
  url: z.string(),
});

export const partyCtaSchema = z.object({ label: z.string(), url: z.string() });

export const artistProfileSchema = z.object({
  id: suiIdSchema,
  kind: z.enum(["individual", "group"]),
  name: z.string(),
  createdAtMs: z.number().int(),
  bioShort: z.string().nullable(),
  bioLong: z.string().nullable(),
  country: z.string().nullable(),
  languages: z.array(z.string()),
  /** Display names, already humanized from the on-chain HIP_HOP form. */
  genres: z.array(z.string()),
  links: z.array(partyLinkSchema),
  ctas: z.array(partyCtaSchema),
  members: z.array(partyMemberSchema),
  /** Present only when requested via `include` — the owner-editor fields. */
  roles: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  avatarUrl: z.string().url(),
});

export const partySummarySchema = z.object({
  id: suiIdSchema,
  name: z.string(),
  kind: z.enum(["individual", "group"]),
});

export const partySummariesSchema = z.array(partySummarySchema);

// ── Wallet-scoped ────────────────────────────────────────────────────────────

export const ownedRecordSchema = z.object({
  id: suiIdSchema,
  type: z.string(),
  releaseId: suiIdSchema,
  pressingId: suiIdSchema,
  edition: u16Schema.min(1),
  /** This copy's non-zero number in its edition. */
  number: u32Schema.min(1),
  purchaseCurrency: z.string().min(1),
  purchasePrice: u64Schema,
  purchasedBy: suiIdSchema,
  purchasedTimestampMs: u64Schema,
});

export const ownedRecordsSchema = z.array(ownedRecordSchema);

export const ownedPartySchema = z.object({
  partyId: suiIdSchema,
  capId: suiIdSchema,
  name: z.string(),
  kind: z.enum(["individual", "group"]),
});

export const ownedPartiesSchema = z.array(ownedPartySchema);

/** A group invitation awaiting action by a party the wallet administers. */
export const pendingMembershipSchema = z.object({
  memberPartyId: suiIdSchema,
  memberCapId: suiIdSchema,
  groupId: suiIdSchema,
  groupName: z.string(),
});

export const pendingMembershipsSchema = z.array(pendingMembershipSchema);

export const workKindSchema = z.enum(["composition", "recording", "release"]);

export const ownedWorkSchema = z.object({
  /** The ADMIN CAP object id — the catalog's routing key. */
  capId: suiIdSchema,
  kind: workKindSchema,
  workId: suiIdSchema,
  title: z.string(),
  state: z.string(),
});

export const ownedWorksSchema = z.array(ownedWorkSchema);

export const workDetailSchema = ownedWorkSchema.extend({
  subtitle: z.string().optional(),
  royaltyRateBps: z.number().int().min(0).max(10_000).optional(),
  shareType: z.string().optional(),
  discCount: z.number().int().min(0).optional(),
  trackCount: z.number().int().min(0).optional(),
});

/** Details for every currently administered work in one wallet read. */
export const workDetailsSchema = z.array(workDetailSchema);

export const balanceSchema = z
  .object({
    address: suiIdSchema,
    coinType: z.string(),
    /** Base units. `coinBalance + addressBalance`. */
    balance: u64Schema,
    /** Base units held in address-owned `Coin<T>` objects. */
    coinBalance: u64Schema,
    /** Base units held in the address balance and available to `FundsWithdrawal`. */
    addressBalance: u64Schema,
    decimals: z.number().int().min(0).max(18),
  })
  .superRefine((value, context) => {
    if (
      ![value.balance, value.coinBalance, value.addressBalance].every((part) =>
        /^\d+$/.test(part)
      )
    ) {
      return
    }
    if (
      BigInt(value.coinBalance) + BigInt(value.addressBalance) !==
      BigInt(value.balance)
    ) {
      context.addIssue({
        code: "custom",
        path: ["balance"],
        message: "expected coinBalance + addressBalance to equal balance",
      });
    }
  });

export const ownershipSchema = z.object({
  address: suiIdSchema,
  objectId: suiIdSchema,
  isOwner: z.boolean(),
  /** Party checks only — the derived PartyAdminCap id owner-gated writes need. */
  capId: suiIdSchema.optional(),
});

// ── Receipts ─────────────────────────────────────────────────────────────────

export const recordSaleSchema = z.object({
  listingId: suiIdSchema,
  pressingId: suiIdSchema,
  releaseId: suiIdSchema,
  recordId: suiIdSchema,
  edition: u16Schema.min(1),
  number: u32Schema.min(1),
  purchaseCurrency: z.string().min(1),
  purchasePrice: u64Schema,
  purchasedBy: suiIdSchema,
  purchasedTimestampMs: u64Schema,
  pricing: priceSchema,
});

export const trackRoyaltySchema = z.object({
  no: z.string(),
  title: z.string(),
  recordingId: suiIdSchema,
  splitBps: z.number().int().min(0).max(10_000),
  amount: u64Schema,
  /** Both null when the composition's royalty rate could not be resolved. */
  composition: u64Schema.nullable(),
  recording: u64Schema.nullable(),
});

export const purchaseReceiptSchema = z.object({
  sale: recordSaleSchema,
  detail: pressingDetailSchema,
  tracks: z.array(trackRoyaltySchema),
});

export const purchaseReceiptWireSchema = z.object({
  sale: recordSaleSchema,
  detail: pressingDetailWireSchema,
  tracks: z.array(trackRoyaltySchema),
});

// ── Errors ───────────────────────────────────────────────────────────────────

/** The envelope every non-2xx carries, matching miso-api's `apiError`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

// ── Royalty claims ───────────────────────────────────────────────────────────

/** One pool swept by a royalty claim transaction. */
export const royaltyClaimEntrySchema = z.object({
  poolId: suiIdSchema,
  stakeId: suiIdSchema,
  /** The pool's share type, e.g. `0x…::share::Share`. */
  shareType: z.string(),
  /** The currency paid out, e.g. the network's stable coin type. */
  currency: z.string(),
  /** Base units of `currency`, a u64 as a decimal string. */
  amount: z.string().regex(/^\d+$/),
});

/** One royalty claim transaction sent by the wallet. */
export const royaltyClaimSchema = z.object({
  txDigest: z.string().min(1),
  /** Checkpoint timestamp, milliseconds since the epoch; 0 when the index had none. */
  timestampMs: z.number().int().nonnegative(),
  /** The pools swept, in event order. */
  entries: z.array(royaltyClaimEntrySchema),
});

/** A page of a wallet's royalty claims, newest first. */
export const royaltyClaimsPageSchema = z.object({
  claims: z.array(royaltyClaimSchema),
  /** Pass as `before` for the next (older) page; null when none remain. */
  nextCursor: z.string().nullable(),
  /** Earliest timestamp the event index still covers, or null if unknown. */
  availableFromMs: z.number().int().nullable(),
});
