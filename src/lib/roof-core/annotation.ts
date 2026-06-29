// RoofModel annotation — serialization layer (pure, no DOM).
//
// A saved annotation is a REOPENABLE human-corrected truth, not a throwaway
// export. This module is the single source of truth for its shape so the
// future DB can reuse the exact same fields. Symmetric: buildAnnotation and
// parseAnnotation round-trip.
//
//  - sections            : active geometry = the human_corrected truth
//  - suggestions         : MVP alternatives left unresolved (reopen as ghosts)
//  - rejectedSuggestions : alternatives the human explicitly rejected
//  - rejectedDebug       : MVP auto-dropped candidates (debug only)
//  - review_state        : fully_validated | validated_with_unresolved_suggestions
//  - section.source      : mvp | human | merged (a future MVP rerun must not
//                          overwrite human/merged sections)

export const ENGINE_VERSION = "roof-core-1";
export const ANNOTATION_VERSION = 2;

export type ReviewState = "fully_validated" | "validated_with_unresolved_suggestions";
export type SectionSource = "mvp" | "human" | "merged";

export interface Pt { x: number; y: number }
export interface AnnSection {
  pts: Pt[]; closed: boolean; pitch: number; elev: number; hf: number;
  roof_type: string; source: SectionSource;
  /** Overrides de nœuds manuels (déplacement de faîtiers/arêtiers) — clé nk(x,y)
   *  → position cible {x,y}. DOIT survivre au round-trip save/load sinon les
   *  faîtiers déplacés reviennent à leur position calculée. */
  _no?: Record<string, Pt>;
}
export interface AnnSuggestion extends AnnSection { _alt?: any }

export interface Annotation {
  version: number;
  engine_version: string;
  name: string;
  address: string | null;
  review_state: ReviewState;
  created_at: string;
  updated_at: string;
  image: any;
  mvp_source_snapshot: any;
  calibration: any;
  sections: AnnSection[];
  suggestions: AnnSuggestion[];
  rejectedSuggestions: AnnSuggestion[];
  rejectedDebug: any[];
  accessories: any[];          // RoofAccessory[] (roof-accessories) — pass-through, never sections
  georef: any;                 // frozen-map georeference (provider, center, zoom, north_up…) or null
  metadata: Record<string, any>;
}

export function reviewStateFor(unresolved: number): ReviewState {
  return unresolved > 0 ? "validated_with_unresolved_suggestions" : "fully_validated";
}

function r1(n: any): number { return Math.round((+n || 0) * 10) / 10; }

function normSec(s: any, defSource: SectionSource): AnnSection {
  const src = (s.source === "human" || s.source === "merged" || s.source === "mvp") ? s.source : defSource;
  return {
    pts: (s.pts || []).map(function (p: any) { return { x: r1(p.x), y: r1(p.y) }; }),
    closed: true,
    pitch: +s.pitch || 7, elev: +s.elev || 0, hf: +s.hf || 0,
    roof_type: s.roof_type || "hip", source: src,
    // Préserve les déplacements manuels de nœuds (faîtiers) — sinon save/load
    // les efface et le toit « change » au rechargement.
    ...(s._no && typeof s._no === "object" && Object.keys(s._no).length ? { _no: s._no } : {}),
  };
}
function normSugg(s: any, defSource: SectionSource): AnnSuggestion {
  const base = normSec(s, defSource) as AnnSuggestion;
  if (s._alt) base._alt = s._alt;
  return base;
}

export interface BuildInput {
  name?: string;
  address?: string | null;
  status?: string;
  createdAt?: string;
  now?: string;
  image?: any;
  mvpSnapshot?: any;
  calibration?: any;
  baseMetadata?: Record<string, any>;
  sections: any[];
  suggestions?: any[];
  rejectedSuggestions?: any[];
  rejectedDebug?: any[];
  accessories?: any[];
  georef?: any;
}

export function buildAnnotation(inp: BuildInput): Annotation {
  const suggestions = (inp.suggestions || []).map(function (s) { return normSugg(s, "mvp"); });
  const now = inp.now || new Date().toISOString();
  return {
    version: ANNOTATION_VERSION,
    engine_version: ENGINE_VERSION,
    name: (inp.name || "").trim() || "Sans titre",
    address: inp.address || null,
    review_state: reviewStateFor(suggestions.length),
    created_at: inp.createdAt || now,
    updated_at: now,
    image: inp.image || null,
    mvp_source_snapshot: inp.mvpSnapshot || null,
    calibration: inp.calibration || null,
    sections: (inp.sections || []).map(function (s) { return normSec(s, "human"); }),
    suggestions,
    rejectedSuggestions: (inp.rejectedSuggestions || []).map(function (s) { return normSugg(s, "mvp"); }),
    rejectedDebug: inp.rejectedDebug || [],
    accessories: (inp.accessories || []).map(normAccessory),
    georef: inp.georef || null,
    metadata: Object.assign({}, inp.baseMetadata || {}, { source: "human_corrected", status: inp.status || "validated" }),
  };
}

// Accessories are pass-through (deep clone, idempotent) — never sections. Truth
// is the attach{} block; derived/cache fields are preserved as-is.
function normAccessory(a: any): any {
  return a && typeof a === "object" ? JSON.parse(JSON.stringify(a)) : a;
}

export interface ParsedAnnotation {
  name: string;
  address: string | null;
  review_state: ReviewState;
  created_at: string | null;
  updated_at: string | null;
  image: any;
  mvp_source_snapshot: any;
  calibration: any;
  sections: AnnSection[];
  suggestions: AnnSuggestion[];
  rejectedSuggestions: AnnSuggestion[];
  rejectedDebug: any[];
  accessories: any[];          // RoofAccessory[] (roof-accessories) — pass-through, never sections
  georef: any;                 // frozen-map georeference (provider, center, zoom, north_up…) or null
  metadata: Record<string, any>;
}

export function parseAnnotation(j: any): ParsedAnnotation {
  if (!j || typeof j !== "object") throw new Error("Annotation invalide");
  const secs = Array.isArray(j.sections) ? j.sections : [];
  // Tolerate the earlier export shape where unresolved alts were "alternatives".
  const sugg = Array.isArray(j.suggestions) ? j.suggestions : (Array.isArray(j.alternatives) ? j.alternatives : []);
  return {
    name: j.name || j.title || "Sans titre",
    address: j.address || null,
    review_state: j.review_state === "fully_validated" || j.review_state === "validated_with_unresolved_suggestions"
      ? j.review_state : reviewStateFor(sugg.length),
    created_at: j.created_at || null,
    updated_at: j.updated_at || null,
    image: j.image || null,
    mvp_source_snapshot: j.mvp_source_snapshot || null,
    calibration: j.calibration || null,
    sections: secs.map(function (s: any) { return normSec(s, "mvp"); }),
    suggestions: sugg.map(function (s: any) { return normSugg(s, "mvp"); }),
    rejectedSuggestions: (Array.isArray(j.rejectedSuggestions) ? j.rejectedSuggestions : []).map(function (s: any) { return normSugg(s, "mvp"); }),
    rejectedDebug: Array.isArray(j.rejectedDebug) ? j.rejectedDebug : [],
    accessories: (Array.isArray(j.accessories) ? j.accessories : []).map(normAccessory),
    georef: j.georef || null,
    metadata: j.metadata || {},
  };
}
