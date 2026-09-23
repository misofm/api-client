import { describe, expect, test } from "bun:test";
import {
  compositionCoreSchema,
  compositionCreditsSchema,
  compositionLyricsResourceSchema,
  compositionViewSchema,
  recordingCoreSchema,
  recordingCreditsResourceSchema,
  recordingEngineSessionSchema,
  recordingMasterResourceSchema,
  recordingStreamSchema,
  recordingViewSchema,
  releaseCoreSchema,
  releaseCoverSchema,
  releaseCreditsSchema,
  releaseDescriptionSchema,
  releaseGenresSchema,
  releaseKindSchema,
  releaseTracksSchema,
} from "./schemas.js";

const compositionId = "0x1";
const recordingId = "0x2";
const releaseId = "0x3";
const partyId = "0x4";
const blobId = `${"A".repeat(42)}A`;
const published = { type: "Published" as const, timestampMs: 1_700_000_000_000 };
const credit = { partyId, displayName: "Astra", roles: ["Composer"] };

describe("modular response schemas", () => {
  test("accepts all resource families and reuses current core/lyrics/cover shapes", () => {
    const composition = { shareType: "0x2::composition_share::SHARE", id: compositionId, state: published, title: "Song", royaltyRate: { value: 1000 } };
    const recording = { shareType: "0x2::recording_share::SHARE", id: recordingId, state: published, compositionId };
    const engineSession = { sessionBlobId: blobId, stems: [{ digest: "a".repeat(64), blobId }] };
    const tracks = [{ position: 1, state: "Assigned" as const, compositionId, recordingId, splitBps: 10000 }];
    expect(compositionCoreSchema.parse(composition)).toEqual(composition);
    expect(compositionViewSchema.safeParse({ ...composition, shareType: undefined }).success).toBe(true);
    expect(compositionCreditsSchema.parse({ compositionId, credits: [credit] })).toEqual({ compositionId, credits: [credit] });
    expect(compositionLyricsResourceSchema.parse({ compositionId, lyrics: [{ language: "en", text: "Verse" }] })).toEqual({ compositionId, lyrics: [{ language: "en", text: "Verse" }] });
    expect(recordingViewSchema.safeParse({ ...recording, shareType: undefined }).success).toBe(true);
    expect(recordingCoreSchema.parse(recording)).toEqual(recording);
    expect(recordingCreditsResourceSchema.parse({ recordingId, credits: [credit], primaryArtistIds: [partyId], featuredArtistIds: [] })).toEqual({ recordingId, credits: [credit], primaryArtistIds: [partyId], featuredArtistIds: [] });
    const master = { format: "flac", channels: 2, bit_depth: 24, sample_rate_hz: 96000, samples: "9007199254740993", pcm_digest: Array(32).fill(17), blob_id: "0" };
    expect(recordingMasterResourceSchema.parse({ recordingId, masterBlobId: blobId, master })).toEqual({ recordingId, masterBlobId: blobId, master });
    expect(recordingMasterResourceSchema.parse({ recordingId, masterBlobId: null, master: null })).toEqual({ recordingId, masterBlobId: null, master: null });
    expect(compositionCoreSchema.safeParse({ ...composition, shareType: undefined }).success).toBe(false);
    expect(recordingCoreSchema.safeParse({ ...recording, shareType: undefined }).success).toBe(false);
    expect(compositionCoreSchema.safeParse({ ...composition, shareType: "" }).success).toBe(false);
    expect(recordingCoreSchema.safeParse({ ...recording, shareType: "" }).success).toBe(false);
    expect(recordingMasterResourceSchema.safeParse({ recordingId, masterBlobId: blobId }).success).toBe(false);
    expect(recordingStreamSchema.parse({ recordingId, transcodeQuiltId: blobId })).toEqual({ recordingId, transcodeQuiltId: blobId });
    expect(recordingEngineSessionSchema.parse({ recordingId, engineSession })).toEqual({ recordingId, engineSession });
    expect(releaseCoreSchema.parse({ id: releaseId, state: published, title: "EP", trackCount: 1 })).toEqual({ id: releaseId, state: published, title: "EP", trackCount: 1 });
    expect(releaseTracksSchema.parse({ releaseId, tracks })).toEqual({ releaseId, tracks });
    expect(releaseCreditsSchema.parse({ releaseId, credits: [credit] })).toEqual({ releaseId, credits: [credit] });
    const cover = { still: { kind: "blob" as const, blobId }, animated: null };
    expect(releaseCoverSchema.parse({ releaseId, cover })).toEqual({ releaseId, cover });
    expect(releaseKindSchema.parse({ releaseId, kind: "Album" })).toEqual({ releaseId, kind: "Album" });
    expect(releaseDescriptionSchema.parse({ releaseId, description: null })).toEqual({ releaseId, description: null });
    expect(releaseGenresSchema.parse({ releaseId, genres: [{ id: "0x5", name: null }] })).toEqual({ releaseId, genres: [{ id: "0x5", name: null }] });
  });

  test("rejects malformed IDs, attachment values, tracks, and engine mix fields", () => {
    expect(recordingMasterResourceSchema.safeParse({ recordingId, masterBlobId: "bad" }).success).toBe(false);
    expect(recordingStreamSchema.safeParse({ recordingId, transcodeQuiltId: "bad" }).success).toBe(false);
    expect(releaseGenresSchema.safeParse({ releaseId, genres: [{ id: "bad", name: null }] }).success).toBe(false);
    expect(releaseTracksSchema.safeParse({ releaseId, tracks: [{ position: 0, state: "Assigned", compositionId, recordingId, splitBps: 1 }] }).success).toBe(false);
    const parsed = recordingEngineSessionSchema.parse({ recordingId, engineSession: { sessionBlobId: blobId, mixBlobId: blobId, stems: [] } });
    expect(parsed.engineSession).not.toHaveProperty("mixBlobId");
  });
});
