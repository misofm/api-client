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
export type RecordingView = z.infer<typeof s.recordingViewSchema>;
export type CompositionView = z.infer<typeof s.compositionViewSchema>;
export type CompositionLyrics = z.infer<typeof s.compositionLyricsSchema>;
export type RecordingMaster = z.infer<typeof s.recordingMasterSchema>;
export type TrackView = z.infer<typeof s.trackViewSchema>;

export type CompositionCore = z.infer<typeof s.compositionCoreSchema>;
export type CompositionCredits = z.infer<typeof s.compositionCreditsSchema>;
export type CompositionLyricsResource = z.infer<
  typeof s.compositionLyricsResourceSchema
>;
export type RecordingCore = z.infer<typeof s.recordingCoreSchema>;
export type RecordingCreditsResource = z.infer<
  typeof s.recordingCreditsResourceSchema
>;
export type RecordingCredits = RecordingCreditsResource;
export type RecordingMasterResource = z.infer<
  typeof s.recordingMasterResourceSchema
>;
export type RecordingStream = z.infer<typeof s.recordingStreamSchema>;
export type RecordingEngineSession = z.infer<
  typeof s.recordingEngineSessionSchema
>;
export type ReleaseCore = z.infer<typeof s.releaseCoreSchema>;
export type ReleaseTracks = z.infer<typeof s.releaseTracksSchema>;
export type ReleaseCredits = z.infer<typeof s.releaseCreditsSchema>;
export type ReleaseCover = z.infer<typeof s.releaseCoverSchema>;
export type ReleaseKind = z.infer<typeof s.releaseKindSchema>;
export type ReleaseDescription = z.infer<typeof s.releaseDescriptionSchema>;
export type ReleaseGenres = z.infer<typeof s.releaseGenresSchema>;

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
export type ArtistRole = z.infer<typeof s.artistRoleSchema>;
export type ArtistProfile = z.infer<typeof s.artistProfileSchema>;
export type PartySummary = z.infer<typeof s.partySummarySchema>;

export type OwnedRecord = z.infer<typeof s.ownedRecordSchema>;
export type OwnedParty = z.infer<typeof s.ownedPartySchema>;
export type PendingMembership = z.infer<typeof s.pendingMembershipSchema>;
export type WorkKind = z.infer<typeof s.workKindSchema>;
export type OwnedWork = z.infer<typeof s.ownedWorkSchema>;
export type WorkDetail = z.infer<typeof s.workDetailSchema>;
export type WorkDetails = z.infer<typeof s.workDetailsSchema>;
export type Balance = z.infer<typeof s.balanceSchema>;
export type Ownership = z.infer<typeof s.ownershipSchema>;

export type RecordSale = z.infer<typeof s.recordSaleSchema>;
export type TrackRoyalty = z.infer<typeof s.trackRoyaltySchema>;
export type PurchaseReceipt = z.infer<typeof s.purchaseReceiptSchema>;

export type ApiErrorBody = z.infer<typeof s.apiErrorSchema>;
export type RoyaltyClaimEntry = z.infer<typeof s.royaltyClaimEntrySchema>;
export type RoyaltyClaim = z.infer<typeof s.royaltyClaimSchema>;
export type RoyaltyClaimsPage = z.infer<typeof s.royaltyClaimsPageSchema>;
export type RoyaltyStake = z.infer<typeof s.royaltyStakeSchema>;
export type RoyaltyStakeWork = z.infer<typeof s.royaltyStakeWorkSchema>;
export type RoyaltyStakesPage = z.infer<typeof s.royaltyStakesPageSchema>;

export type PartyCore = z.infer<typeof s.partyCoreSchema>;
export type PartyProfile = z.infer<typeof s.partyProfileSchema>;
export type PartyMembers = z.infer<typeof s.partyMembersSchema>;
export type PartyGenres = z.infer<typeof s.partyGenresSchema>;
export type PartyLinks = z.infer<typeof s.partyLinksSchema>;
export type PartyCtas = z.infer<typeof s.partyCtasSchema>;
export type PartyRoles = z.infer<typeof s.partyRolesSchema>;
export type PartyTags = z.infer<typeof s.partyTagsSchema>;

export type RecordCore = z.infer<typeof s.recordCoreSchema>;
export type PressingListingResource = z.infer<typeof s.pressingListingResourceSchema>;
export type RecordPurchase = z.infer<typeof s.recordPurchaseSchema>;
export type PartyPendingMemberships = z.infer<typeof s.partyPendingMembershipsSchema>;
export type WalletRecordReferences = z.infer<typeof s.walletRecordReferencesSchema>;
export type WalletPartyCapabilities = z.infer<typeof s.walletPartyCapabilitiesSchema>;
export type WorkCapability = z.infer<typeof s.workCapabilitySchema>;
export type WalletWorkCapabilities = z.infer<typeof s.walletWorkCapabilitiesSchema>;
export type WorkCapabilityReference = z.infer<typeof s.workCapabilityReferenceSchema>;
export type ShareWorkReference = z.infer<typeof s.shareWorkReferenceSchema>;
export type WalletBalanceResource = z.infer<typeof s.walletBalanceResourceSchema>;
export type CoinMetadataResource = z.infer<typeof s.coinMetadataResourceSchema>;
export type StakeCore = z.infer<typeof s.stakeCoreSchema>;
export type StakeRegistrations = z.infer<typeof s.stakeRegistrationsSchema>;
export type WalletStakeResources = z.infer<typeof s.walletStakeResourcesSchema>;
export type TransactionSaleResource = z.infer<typeof s.transactionSaleResourceSchema>;
