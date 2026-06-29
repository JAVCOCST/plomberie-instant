import { describe, it, expect } from "vitest";
import { sectionIdsOf, isAccessoryOrphan, resolveAccessoryOrphans } from "./resolve";
import { makeAnchor } from "./anchor";

const acc = (sid: string) => ({ id: "a", type: "roof_accessory", product_id: "p", variant_id: "301-16", anchor: makeAnchor({ section_id: sid }) });

describe("accessory orphan resolution", () => {
  it("derives stable string section ids from closed sections only", () => {
    expect(sectionIdsOf([{ closed: true }, { closed: false }, { closed: true }])).toEqual(["S1", "S3"]);
  });

  it("not orphan while its section exists (survives slight geometry/suggestion changes/rebuild)", () => {
    const ids = sectionIdsOf([{ closed: true }, { closed: true }]); // S1, S2
    expect(isAccessoryOrphan(acc("S1"), ids)).toBe(false);
    // a rebuild that keeps S1 = S1 keeps it valid
    expect(isAccessoryOrphan(acc("S1"), sectionIdsOf([{ closed: true }]))).toBe(false);
  });

  it("orphan when its target section disappears", () => {
    expect(isAccessoryOrphan(acc("S2"), sectionIdsOf([{ closed: true }]))).toBe(true);
  });

  it("resolveAccessoryOrphans stamps the flag + orphan_state", () => {
    const out = resolveAccessoryOrphans([acc("S1") as any, acc("S9") as any], ["S1"], "2026-01-01T00:00:00.000Z");
    expect(out[0].accessory_orphaned).toBe(false);
    expect(out[0].anchor.orphan_state).toBeNull();
    expect(out[1].accessory_orphaned).toBe(true);
    expect(out[1].anchor.orphan_state?.reason).toBe("section_not_found");
  });
});
