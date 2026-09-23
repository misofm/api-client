// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// @misofm/api-client — the typed client and response contract for the
// Miso read API.
//
// This package is what every Miso frontend reads through: the PWA, the CLI,
// and third-party clients. It carries no chain code and no Sui dependency — a browser importing it
// gets zod and a fetch wrapper, not a blockchain SDK.
//
//   import { createMisoApiClient } from "@misofm/api-client";
//   const api = createMisoApiClient({ baseUrl: "https://api.testnet.miso.fm" });

export { createMisoApiClient, cacheBuster, MisoApiError, MisoApiContractError, READ_CACHE_CLASS, queryPolicy } from "./client.js";
export type { MisoApiClient, MisoApiClientOptions, MisoApiErrorOptions, MisoRequestOptions, WalletOwnershipTarget } from "./client.js";

export {
  CACHE_POLICIES,
  MODULAR_CACHE_POLICIES,
  MODULAR_READ_RESOURCE,
  browserCacheControl,
  cacheControl,
  cdnCacheControl,
  modularBrowserCacheControl,
  modularCachePolicy,
  modularEdgeCacheControl,
  modularQueryPolicy,
  recordAlbumCacheClass,
  recordAlbumQueryPolicy,
  workCacheClass,
} from "./cache.js";
export type {
  CacheClass,
  CachePolicy,
  ModularCachePolicy,
  ModularQueryPolicyOptions,
  ModularReadMethod,
  ModularResourceClass,
  ModularWorkState,
  RecordAlbumCacheOptions,
  RecordAlbumCacheValue,
} from "./cache.js";

export * as schemas from "./schemas.js";
export type * from "./types.js";

export { PARTY_CACHE_POLICY, partyCachePolicy, partyQueryPolicy } from "./cache.js";
export type { PartyCore, PartyProfile, PartyMembers, PartyGenres, PartyLinks, PartyCtas, PartyRoles, PartyTags } from "./types.js";
