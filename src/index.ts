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

export { CACHE_POLICIES, browserCacheControl, cacheControl, cdnCacheControl, workCacheClass, recordAlbumCacheClass, recordAlbumQueryPolicy } from "./cache.js";
export type { CacheClass, CachePolicy, RecordAlbumCacheOptions, RecordAlbumCacheValue } from "./cache.js";

export * as schemas from "./schemas.js";
export type * from "./types.js";
