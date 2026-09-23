// Copyright (c) Miso Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "@misofm/api-client";
const requiredFiles = [
  "LICENSE",
  "README.md",
  "package.json",
  ...["index", "client", "schemas", "types", "cache"].flatMap((name) => [
    `dist/${name}.js`,
    `dist/${name}.d.ts`,
  ]),
];

const temp = await mkdtemp(join(tmpdir(), "miso-api-client-"));
try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packed = JSON.parse(
    execFileSync(npm, ["pack", "--json", "--pack-destination", temp], {
      encoding: "utf8",
    }),
  )[0];
  if (!packed?.filename || !Array.isArray(packed.files))
    throw new Error("npm pack did not return a package manifest");

  const files = new Set(packed.files.map(({ path }) => path));
  const missing = requiredFiles.filter((path) => !files.has(path));
  if (missing.length > 0)
    throw new Error(`packed artifact is missing: ${missing.join(", ")}`);

  const forbidden = [...files].filter(
    (path) =>
      path.startsWith("src/") ||
      path.includes(".test.") ||
      (path.endsWith(".ts") && !path.endsWith(".d.ts")),
  );
  if (forbidden.length > 0)
    throw new Error(`packed artifact contains source/tests: ${forbidden.join(", ")}`);

  const consumer = join(temp, "consumer.mjs");
  await writeFile(
    join(temp, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const tarball = join(temp, packed.filename);
  execFileSync(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: temp, stdio: "inherit" },
  );
  await writeFile(
    consumer,
    `
      import * as root from "${packageName}";
      import * as schemas from "${packageName}/schemas";
      import * as types from "${packageName}/types";
      import * as cache from "${packageName}/cache";
      if (typeof root.createMisoApiClient !== "function") throw new Error("root export failed");
      if (!schemas.balanceSchema || !schemas.releaseCoreSchema || !schemas.recordingMasterResourceSchema || !schemas.pressingListingResourceSchema || !schemas.walletRecordReferencesSchema) throw new Error("schemas export failed");
      if (typeof types !== "object") throw new Error("types export failed");
      if (typeof cache.cacheControl !== "function" || typeof cache.modularCachePolicy !== "function") throw new Error("cache export failed");
      const client = root.createMisoApiClient({ baseUrl: "https://api.test" });
      for (const method of ["getCompositionCore", "getCompositionCredits", "getCompositionLyricsResource", "getRecordingCore", "getRecordingCredits", "getRecordingMaster", "getRecordingStream", "getRecordingEngineSession", "getReleaseCore", "getReleaseTracks", "getReleaseCredits", "getReleaseCover", "getReleaseKind", "getReleaseDescription", "getReleaseGenres"]) {
        if (typeof client[method] !== "function") throw new Error(method + " packed export failed");
      }
      for (const method of ["getPressingCore", "getPressingListingResource", "getRecordCore", "getRecordPurchase", "getPartyPendingMemberships", "listWalletRecordReferences", "listWalletPartyCapabilities", "listWalletWorkCapabilities", "getWorkCapability", "getWorkCapabilityReference", "getWalletBalanceResource", "getCoinMetadata", "getStakeCore", "getStakeRegistrations", "listWalletStakeResources", "getShareWorkReference", "listWalletRoyaltyClaimsResource", "getPartyOwnershipResource", "getRecordOwnershipResource", "getTransactionSale"]) {
        if (typeof client[method] !== "function") throw new Error(method + " packed export failed");
      }
    `,
  );
  execFileSync(process.execPath, [consumer], {
    cwd: temp,
    stdio: "inherit",
  });

  await writeFile(
    join(temp, "consumer.ts"),
    `
      import { createMisoApiClient, type MisoApiClient, type ResourcePageOptions } from "${packageName}";
      import { balanceSchema } from "${packageName}/schemas";
      import { cacheControl } from "${packageName}/cache";
      import type { Balance, ReleaseCore, RecordingMasterResource, PressingListingResource, WalletRecordReferences, WorkCapabilityReference } from "${packageName}/types";
      const client: MisoApiClient = createMisoApiClient({ baseUrl: "https://api.test" });
      const result: Promise<Balance> = client.getWalletBalance("0x1");
      void result;
      const release: Promise<ReleaseCore | null> = client.getReleaseCore("0x1");
      const master: Promise<RecordingMasterResource | null> = client.getRecordingMaster("0x2");
      void release;
      void master;
      const page: ResourcePageOptions = { limit: 10 };
      const records: Promise<WalletRecordReferences> = client.listWalletRecordReferences("0x1", page);
      const listing: Promise<PressingListingResource | null> = client.getPressingListingResource("0x1", "0x2::sui::SUI");
      const capability: Promise<WorkCapabilityReference | null> = client.getWorkCapabilityReference("0x1");
      void records; void listing; void capability;
      balanceSchema.parse({ address: "0x1", coinType: "coin", balance: "0", decimals: 0 });
      cacheControl("private");
    `,
  );
  await writeFile(
    join(temp, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: ["consumer.ts"],
    }),
  );
  const typescript = import.meta.resolve("typescript");
  const tsc = fileURLToPath(new URL("./tsc.js", typescript));
  execFileSync(process.execPath, [tsc, "-p", join(temp, "tsconfig.json")], {
    cwd: temp,
    stdio: "inherit",
  });
  console.log(`verified ${packed.filename}: ${files.size} files, runtime exports, and declarations`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
