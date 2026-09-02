// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Types inferred from ./schemas.ts. Nothing is hand-written here on purpose — a
// type and its validator that can disagree will eventually disagree.

import type { z } from "zod";
import type * as s from "./schemas.js";

export type WorkState = z.infer<typeof s.workStateSchema>;
export type CoverImage = z.infer<typeof s.coverImageSchema>;
export type Cover = z.infer<typeof s.coverSchema>;
export type Credit = z.infer<typeof s.creditSchema>;
export type TrackView = z.infer<typeof s.trackViewSchema>;

export type ReleaseDetail = z.infer<typeof s.releaseDetailSchema>;
export type TrackCredits = z.infer<typeof s.trackCreditsSchema>;
export type Price = z.infer<typeof s.priceSchema>;
export type Currency = z.infer<typeof s.currencySchema>;
export type PressingView = z.infer<typeof s.pressingViewSchema>;
export type ListingView = z.infer<typeof s.listingViewSchema>;
export type PressingDetail = z.infer<typeof s.pressingDetailSchema>;
export type RecordAlbum = z.infer<typeof s.recordAlbumSchema>;

export type PartyMember = z.infer<typeof s.partyMemberSchema>;
export type PlatformKey = z.infer<typeof s.platformKeySchema>;
export type PartyLink = z.infer<typeof s.partyLinkSchema>;
export type PartyCta = z.infer<typeof s.partyCtaSchema>;
export type ArtistProfile = z.infer<typeof s.artistProfileSchema>;
export type PartySummary = z.infer<typeof s.partySummarySchema>;

export type OwnedRecord = z.infer<typeof s.ownedRecordSchema>;
export type OwnedParty = z.infer<typeof s.ownedPartySchema>;
export type PendingMembership = z.infer<typeof s.pendingMembershipSchema>;
export type WorkKind = z.infer<typeof s.workKindSchema>;
export type OwnedWork = z.infer<typeof s.ownedWorkSchema>;
export type WorkDetail = z.infer<typeof s.workDetailSchema>;
export type Balance = z.infer<typeof s.balanceSchema>;
export type Ownership = z.infer<typeof s.ownershipSchema>;

export type RecordSale = z.infer<typeof s.recordSaleSchema>;
export type TrackRoyalty = z.infer<typeof s.trackRoyaltySchema>;
export type PurchaseReceipt = z.infer<typeof s.purchaseReceiptSchema>;

export type ApiErrorBody = z.infer<typeof s.apiErrorSchema>;
