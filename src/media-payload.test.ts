import { expect, test } from "bun:test";
import { coverSchema, recordingMasterSchema } from "./schemas.js";
const blobId = "nbLHshlVrtwY88bLYmD6Qq0cdTOF8odmgWyGYmH9aKU";
test("covers preserve blob references without requiring a host", () => {
  const cover = { still: { kind: "blob" as const, blobId }, animated: { kind: "blob" as const, blobId } };
  expect(coverSchema.parse(cover)).toEqual(cover);
  expect(coverSchema.safeParse({ ...cover, still: { kind: "blob" as const, blobId: "bad" } }).success).toBe(false);
});
test("cached URL covers remain readable during deployment", () => {
  expect(coverSchema.parse({ still: { kind: "blob", url: `https://cdn.miso.fm/v1/blobs/${blobId}` }, animated: null }).still).toHaveProperty("url");
});
test("full master metadata retains encrypted and unencrypted data", () => {
  for (const confidentiality of [{ $kind: "Unencrypted" as const, Unencrypted: true as const }, { $kind: "Encrypted" as const, Encrypted: { sealed_dek: [1, 2, 3] } }]) {
    const master = { format: "flac", channels: 2, bit_depth: 24, sample_rate_hz: 44100, samples: "8500549", pcm_digest: Array(32).fill(3), data: { blob_id: "42", confidentiality } };
    expect(recordingMasterSchema.parse(master)).toEqual(master);
    expect(recordingMasterSchema.safeParse({ ...master, pcm_digest: [256] }).success).toBe(false);
  }
});
