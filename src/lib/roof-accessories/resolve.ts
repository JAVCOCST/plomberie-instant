// Accessory orphan resolution (pure).
//
// An accessory is orphaned when its anchor.section_id no longer resolves to an
// existing (closed) section — e.g. the section was deleted. Slight geometry
// edits, suggestion changes, promote/reject, or a rebuild keep S1 = S1, so the
// accessory stays valid. Section ids are derived as stable strings "S{n}".

import { AccessoryInstance } from "./types";

/** Stable string ids of the resolvable (closed) sections, in order. */
export function sectionIdsOf(sections: { closed?: boolean }[]): string[] {
  const ids: string[] = [];
  (sections || []).forEach(function (s, i) { if (s && s.closed) ids.push("S" + (i + 1)); });
  return ids;
}

export function isAccessoryOrphan(acc: any, existingSectionIds: string[]): boolean {
  return !(acc && acc.anchor && existingSectionIds.indexOf(acc.anchor.section_id) >= 0);
}

/** Re-mark orphan state on a list; pure (caller decides whether to commit). */
export function resolveAccessoryOrphans(accessories: AccessoryInstance[], existingSectionIds: string[], now?: string): AccessoryInstance[] {
  const ts = now || new Date().toISOString();
  return (accessories || []).map(function (a) {
    const orph = isAccessoryOrphan(a, existingSectionIds);
    return Object.assign({}, a, {
      accessory_orphaned: orph,
      anchor: Object.assign({}, a.anchor, { orphan_state: orph ? { reason: "section_not_found", orphaned_at: ts } : null }),
    });
  });
}
