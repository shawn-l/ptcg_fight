import { describe, expect, it } from "vitest";
import { getCardById, sampleCards, validateCardCatalog } from "../src";

describe("card catalog", () => {
  it("validates stable English ids with Simplified Chinese mapping and E/F/G regulation marks", () => {
    const report = validateCardCatalog(sampleCards);

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(getCardById(sampleCards, "sv1-001")?.languageRefs.zhHans?.name).toBe("新叶喵");
    expect(new Set(sampleCards.map((card) => card.regulationMark))).toEqual(new Set(["E", "F", "G"]));
  });
});
