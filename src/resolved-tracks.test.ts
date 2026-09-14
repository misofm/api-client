import { expect, test } from "bun:test";
import { trackViewSchema } from "./schemas.js";

const track = { no: "1", title: "Song", splitBps: 10000, disc: 1 };
const recording = { id: "0x1", state: { type: "Published" as const, timestampMs: 123 }, compositionId: "0x2" };
const composition = { id: "0x2", state: { type: "Initialized" as const }, title: "Song", royaltyRate: { value: 1500 } };
test("keeps complete nested recording and composition objects", () => {
  const value = { ...track, recording, composition };
  expect(trackViewSchema.parse(value)).toEqual(value);
});
test("requires both resolved objects and strips redundant ids", () => {
  expect(trackViewSchema.safeParse({ ...track, recording: null, composition }).success).toBe(false);
  expect(trackViewSchema.safeParse({ ...track, recording, composition: null }).success).toBe(false);
  const value = trackViewSchema.parse({ ...track, recording, composition, recordingId: "0x1", compositionId: "0x2" });
  expect(value).not.toHaveProperty("recordingId");
  expect(value).not.toHaveProperty("compositionId");
});
test("validates nested object fields", () => {
  expect(trackViewSchema.safeParse({ ...track, composition: { ...composition, royaltyRate: { value: 10001 } } }).success).toBe(false);
  expect(trackViewSchema.safeParse({ ...track, recording: { ...recording, compositionId: "invalid" } }).success).toBe(false);
});

test("preserves the recording share type and accepts older cached recordings", () => {
  const value = { ...track, recording: { ...recording, shareType: "0x3::share::Share" }, composition };
  expect(trackViewSchema.parse(value)).toEqual(value);
  expect(trackViewSchema.parse({ ...track, recording, composition }).recording).not.toHaveProperty("shareType");
});
