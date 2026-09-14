import { describe, expect, test } from "bun:test";
import {
  listingViewSchema,
  ownedRecordSchema,
  pressingViewSchema,
  purchaseReceiptSchema,
  recordSaleSchema,
} from "./schemas.js";

const sale = {
  listingId: "0x1",
  recordId: "0x2",
  releaseId: "0x3",
  pressingId: "0x4",
  edition: 1,
  number: 7,
  purchaseCurrency: "0x2::sui::SUI",
  purchasePrice: "125",
  purchasedBy: "0x5",
  purchasedTimestampMs: "18446744073709551615",
  pricing: { kind: "floor" as const, amount: "100" },
};

const detail = {
  pressing: {
    id: "0x4",
    releaseId: "0x3",
    edition: 1,
    supply: 7,
    maxSupply: null,
    distributors: ["0x6::witness::Witness"],
  },
  release: {
    id: "0x3",
    title: "Album",
    subtitle: null,
      description: null,
    kind: null,
    state: { type: "Initialized" as const },
    publishedAtMs: null,
    cover: null,
    credits: [],
    primaryArtists: [],
    genres: [],
    discCount: 0,
    tracks: [],
  },
};

describe("Record and Record Shop schemas", () => {
  test("Pressing uses bounded u16/u32 numbers and has no lifecycle state", () => {
    expect(pressingViewSchema.parse(detail.pressing)).toEqual(detail.pressing);
    expect(() => pressingViewSchema.parse({ ...detail.pressing, edition: 65_536 })).toThrow();
    expect(() => pressingViewSchema.parse({ ...detail.pressing, supply: 0x1_0000_0000 })).toThrow();
    expect(() => pressingViewSchema.parse({ ...detail.pressing, maxSupply: 0 })).toThrow();
  });

  test("Listing exposes configured Pricing, currency, and switch state", () => {
    const listing = {
      id: "0x1",
      pressingId: "0x4",
      releaseId: "0x3",
      pricing: { kind: "fixed" as const, amount: "100" },
      currency: { type: "0x2::sui::SUI", symbol: "SUI", decimals: 9 },
      state: "enabled" as const,
    };
    expect(listingViewSchema.parse(listing)).toEqual(listing);
    expect(() => listingViewSchema.parse({ ...listing, pricing: { ...listing.pricing, amount: 100 } }))
      .toThrow();
  });

  test("OwnedRecord requires complete immutable purchase provenance", () => {
    const owned = {
      id: sale.recordId,
      type: "0x7::record::Record",
      releaseId: sale.releaseId,
      pressingId: sale.pressingId,
      edition: sale.edition,
      number: sale.number,
      purchaseCurrency: sale.purchaseCurrency,
      purchasePrice: sale.purchasePrice,
      purchasedBy: sale.purchasedBy,
      purchasedTimestampMs: sale.purchasedTimestampMs,
    };
    expect(ownedRecordSchema.parse(owned)).toEqual(owned);
    expect(() => ownedRecordSchema.parse({ ...owned, purchasedTimestampMs: 123 })).toThrow();
    expect(() => ownedRecordSchema.parse({ ...owned, pressingId: undefined })).toThrow();
  });

  test("receipt keeps configured Pricing distinct from the actual purchase price", () => {
    expect(recordSaleSchema.parse(sale)).toEqual(sale);
    const receipt = purchaseReceiptSchema.parse({
      sale: { ...sale, paid: sale.purchasePrice, buyer: sale.purchasedBy, price: sale.purchasePrice },
      detail,
      price: sale.purchasePrice,
      tracks: [],
    });
    expect(receipt).toEqual({ sale, detail, tracks: [] });
    expect(receipt.sale.pricing.amount).toBe("100");
    expect(receipt.sale.purchasePrice).toBe("125");
    expect(receipt.sale).not.toHaveProperty("paid");
    expect(receipt.sale).not.toHaveProperty("buyer");
    expect(receipt).not.toHaveProperty("price");
  });

  test("edition and copy number are numbers while every u64 stays a string", () => {
    expect(() => recordSaleSchema.parse({ ...sale, number: "7" })).toThrow();
    expect(() => recordSaleSchema.parse({ ...sale, purchasePrice: 125 })).toThrow();
    expect(() => recordSaleSchema.parse({ ...sale, purchasedTimestampMs: 1_700_000_000_000 })).toThrow();
  });
});
