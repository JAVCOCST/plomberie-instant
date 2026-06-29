// migrate.ts — tolerant JSON schema migration for persisted RoofTakeoff payloads.
//
// Schema evolution is handled here (pure, version-aware), never in SQL. Reads
// are forgiving: unknown/older payloads are coerced to the current shape with
// safe defaults so a load never throws.
import type { RoofTakeoff } from "./types";
import { ROOF_TAKEOFF_SCHEMA_VERSION } from "./types";

/** Compare dotted semver-ish strings ("1.0.0"). Returns -1/0/1. */
export function cmpSchemaVersion(a: string, b: string): number {
  const pa = (a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = (b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Migrate a raw persisted payload to the current RoofTakeoff schema. */
export function migrateRoofTakeoff(payload: any): RoofTakeoff {
  if (!payload || typeof payload !== "object") throw new Error("RoofTakeoff payload invalide");
  const t = payload as RoofTakeoff;
  const ver = (t.metadata && t.metadata.schemaVersion) || "0.0.0";

  // No future-version downgrade; same-version is a pass-through.
  // (Older → current upgrades are added here as the schema evolves.)
  if (cmpSchemaVersion(ver, ROOF_TAKEOFF_SCHEMA_VERSION) === 0) return ensureShape(t);

  return ensureShape({
    ...t,
    metadata: { ...(t.metadata || {}), schemaVersion: ROOF_TAKEOFF_SCHEMA_VERSION },
  } as RoofTakeoff);
}

// Fill the minimum structural defaults so consumers never hit undefined blocks.
function ensureShape(t: RoofTakeoff): RoofTakeoff {
  if (!t.business) (t as any).business = { workScope: "refection", sectionRoleOverrides: {}, penetrations: [], accessories: [], overrides: [] };
  if (!t.business.penetrations) t.business.penetrations = [];
  if (!t.business.accessories) t.business.accessories = [];
  if (!t.business.overrides) t.business.overrides = [];
  if (!t.business.sectionRoleOverrides) t.business.sectionRoleOverrides = {};
  if (!t.validation) (t as any).validation = { level: "ok", issues: [], validatedByHuman: false };
  if (!t.revision) {
    const now = new Date().toISOString();
    (t as any).revision = { revision: 0, status: "draft", createdAt: now, updatedAt: now };
  }
  return t;
}
