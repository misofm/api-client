# `@misofm/api-client`

Typed ESM client, Zod schemas, and response types for the Miso read API. Every
successful response is validated before it reaches application code, and u64/u128
values stay decimal strings so JavaScript never silently loses precision.

## Install

Modular protocol reads are available through `getComposition(id)`,
`getRecording(id)`, and `getCompositionLyrics(id)`. Lyrics are fetched only by
the latter and return `{ compositionId, lyrics: [{ language, text }] }` with
decoded UTF-8 text. Missing objects return `null`; an existing composition
without lyrics returns an empty list. All three methods support cancellation
and the client's mutable-resource cache version.

```sh
npm install @misofm/api-client
```

The package ships JavaScript and declarations and works directly in modern Node,
browsers, Bun, and Workers. It requires a global `fetch`, or an injected compatible
implementation.

## Create a client

```ts
import { createMisoApiClient } from "@misofm/api-client";

const api = createMisoApiClient({
  baseUrl: "https://api.testnet.miso.fm",
});

const pressing = await api.getPressing(pressingId);
if (pressing) {
  console.log(pressing.releaseId, pressing.edition, pressing.supply);
}
```

Reads for resources that may legitimately be absent return `null` on 404.
Collection and required wallet reads return their body or throw.

Version 0.18 uses `/v1/protocol` for releases, administered works, and royalty
claims, and `/v1/platform` for pressings, records, artists, ownership, and receipts.
This is a breaking route change. The removed pressing-based `getReceipt` helper
has no replacement alias; use `getPurchaseReceipt(txDigest, recordId)`.

## Methods

Singular resources use `get…`; collections use `list…`:

| Area | Canonical methods |
| --- | --- |
| Catalog | `getPressing`, `getPressingListing`, `getRelease`, `getRecordAlbum` |
| Artists | `getArtist`, `listArtists` |
| Wallet | `listWalletRecords`, `listWalletParties`, `listWalletPendingMemberships`, `listWalletWorks`, `listWalletWorkDetails`, `getWalletBalance`, `getWalletOwnership`, `getWalletPartyOwnership`, `getWalletRecordOwnership` |
| Works and receipts | `getWork`, `getPurchaseReceipt` |

Older names (`getListing`, `getArtists`, `getWalletRecords`,
`getWalletParties`, `getPendingMemberships`, `getWalletWorks`, `getBalance`,
`ownsParty`, and `ownsRecord`) remain backward-compatible aliases and are marked
deprecated for editor-assisted migration. These aliases use the current routes.

`getWalletWorkDetails` is the deprecated compatibility alias for
`listWalletWorkDetails`. Both make one private request to return all three work
kinds in the typed `WorkDetail[]` shape.

Relationship expansions live in the method options:

```ts
const release = await api.getRelease(releaseId, {
  include: ["trackCredits"],
});

const album = await api.getRecordAlbum(recordId, {
  include: ["release", "trackCredits"],
});
```

## Cancellation and request headers

Every method accepts per-call request options. Methods with relationship options
use the same options object; `getWalletBalance` keeps its existing optional coin
type argument and accepts request options third.

```ts
const controller = new AbortController();

const profile = await api.getArtist(partyId, {
  include: ["roles"],
  signal: controller.signal,
  headers: { "X-Request-ID": crypto.randomUUID() },
});

const balance = await api.getWalletBalance(address, coinType, {
  signal: AbortSignal.timeout(5_000),
});
```

## Errors

API failures throw `MisoApiError`. Contract mismatches throw
`MisoApiContractError`, which generally means the deployed API and client package
need to be brought to compatible versions.

```ts
import { MisoApiContractError, MisoApiError } from "@misofm/api-client";

try {
  await api.getWalletBalance(address);
} catch (error) {
  if (error instanceof MisoApiError) {
    console.error(error.status, error.code, error.message);
    console.error("request", error.requestId);
    if (error.retryAfter !== undefined) {
      console.error(`retry after ${error.retryAfter} seconds`);
    }
  } else if (error instanceof MisoApiContractError) {
    console.error(error.issues);
  } else {
    throw error;
  }
}
```

## Read-after-write and caching

There is no global purge layer. Applications that have just completed a write can
bump one long-lived client so its next mutable public read bypasses a pre-write
edge entry:

```ts
import { cacheBuster, createMisoApiClient } from "@misofm/api-client";

let version: string | undefined;
const api = createMisoApiClient({
  baseUrl: "https://api.testnet.miso.fm",
  version: () => version,
});

await submitWrite();
version = cacheBuster();
const updated = await api.getArtist(partyId);
```

The `v` parameter is intentionally resource-scoped. It is added to mutable public
reads such as artists, pressings, listings, releases, and expanded record albums.
It is not added to private wallet reads, immutable purchase receipts, or the bare
record-to-release relation, preventing useless cache namespaces.

Use `cacheBuster()` rather than inventing a version string. The gateway accepts
its timestamp-plus-random-nonce token through the longest public cache window,
then safely returns to the unversioned entry. Generate it once per completed
write and reuse it for that post-write read burst. Arbitrary strings used by
0.5.1 clients remain compatible through one shared no-store namespace, but do
not create attacker-controlled cache keys.

For TanStack Query, use the shared cache helpers:

```ts
import {
  READ_CACHE_CLASS,
  queryPolicy,
  recordAlbumQueryPolicy,
  workCacheClass,
} from "@misofm/api-client/cache";

queryPolicy(READ_CACHE_CLASS.getPressing);
queryPolicy(workCacheClass(release?.state));
recordAlbumQueryPolicy(album, { include: ["release"] });
```

`READ_CACHE_CLASS.getRecordAlbum` is retained for compatibility and describes
only an unexpanded response. Expanded release metadata is response-dependent, so
use `recordAlbumQueryPolicy` for that case.

## Schemas and types

All documented subpaths are stable package exports:

```ts
import { schemas } from "@misofm/api-client";
import { pressingViewSchema } from "@misofm/api-client/schemas";
import { browserCacheControl, cacheControl } from "@misofm/api-client/cache";
import type { PressingView } from "@misofm/api-client/types";

const parsed: PressingView = pressingViewSchema.parse(payload);
schemas.pressingViewSchema.parse(parsed);
cacheControl("sale");
browserCacheControl("sale"); // pair with the CDN-only policy in edge runtimes
```

The schemas are the source of truth shared by the read service, generated API
description, and consumers. The package is maintained in the
[`misofm/api-client`](https://github.com/misofm/api-client) repository and
licensed under Apache-2.0.
