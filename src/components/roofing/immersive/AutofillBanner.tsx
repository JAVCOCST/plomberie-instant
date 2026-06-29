/**
 * AutofillBanner
 * ──────────────
 *
 * Bandeau qui affiche l'état des 3 sources d'auto-remplissage (Brikk MAMH,
 * Solar API, roof-classify) avec icônes de statut et bouton "Actualiser".
 *
 * Visuel : compact, mobile-first, ne déborde pas (cf. AQG-006 de l'audit
 * mobile). Padding réduit + `flex-wrap` pour qu'il rentre dans les iPhones
 * étroits sans scroll horizontal.
 *
 * Ce composant n'effectue aucun fetch — il consomme un objet `status` produit
 * par l'appelant (qui combine le résultat de `useAutofillFromAddress` +
 * `useSolarRoofModel`). Pur sur les props.
 *
 * Vague A2.1 — ajout du mode "armed" :
 *   - Quand `armed === false` (= bouton Run pas encore cliqué pour cette
 *     adresse), on n'affiche QUE le bouton primaire "Lancer l'auto-
 *     remplissage", pas les 3 indicateurs. Aucune query n'est lancée côté
 *     coordinator tant que ce bouton n'est pas cliqué.
 *   - Quand `armed === true`, on affiche les indicateurs comme avant +
 *     le bouton "Actualiser".
 */

import {
  CheckCircle2,
  CircleSlash,
  Loader2,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

export type SourceState = "idle" | "loading" | "ok" | "error" | "na";

export interface AutofillBannerSource {
  /** Label court affiché à l'utilisateur (ex: "MAMH", "Solar", "Type de couverture"). */
  label: string;
  state: SourceState;
  /** Message d'aide ou d'erreur succinct, affiché sous le label. */
  hint?: string;
}

export interface AutofillBannerProps {
  sources: AutofillBannerSource[];
  /** Appelé quand l'utilisateur clique "Actualiser". */
  onRefresh?: () => void;
  /** True pendant que les sources sont en cours (désactive le bouton). */
  isRefreshing?: boolean;
  /**
   * Vague A2.1 : true quand le bouton Run a été cliqué pour l'adresse
   * courante. False sinon → on n'affiche QUE le bouton Run.
   */
  armed?: boolean;
  /** Appelé quand l'utilisateur clique sur "Lancer l'auto-remplissage". */
  onArm?: () => void;
  /**
   * True quand l'adresse est saisie et les coordonnées sont disponibles
   * (lat/lng OK). Si false, le bouton Run est désactivé.
   */
  canArm?: boolean;
}

function StateIcon({ state }: { state: SourceState }) {
  switch (state) {
    case "loading":
      return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />;
    case "ok":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "error":
      return <TriangleAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case "na":
      return <CircleSlash className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
    case "idle":
    default:
      return <CircleSlash className="w-3.5 h-3.5 text-zinc-600 shrink-0" />;
  }
}

export default function AutofillBanner({
  sources,
  onRefresh,
  isRefreshing,
  armed = true,
  onArm,
  canArm = true,
}: AutofillBannerProps) {
  // Vague A2.1 — Mode "pre-armed" : on n'affiche que le bouton Run.
  // Aucun indicateur de source visible, aucun statut, juste l'invitation
  // à déclencher manuellement l'autofill. Tant que ce bouton n'est pas
  // cliqué, aucune query ne part côté coordinator (économie Google Solar
  // + appels inutiles si l'utilisateur tape mal l'adresse).
  if (!armed && onArm) {
    return (
      <div
        className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 flex flex-wrap items-center gap-2"
        role="status"
        aria-label="Auto-remplissage en attente"
      >
        <span className="font-medium text-zinc-100 mr-1 shrink-0">Auto :</span>
        <span className="text-[11px] text-zinc-400 shrink-0">
          Adresse confirmée. Cliquez pour récupérer les données municipales + Solar.
        </span>
        <button
          type="button"
          onClick={onArm}
          disabled={!canArm}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-indigo-700/60 bg-indigo-900/40 px-3 py-1.5 text-[11px] text-indigo-100 hover:bg-indigo-900/60 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 font-medium"
        >
          <Play className="w-3 h-3" />
          Lancer l'auto-remplissage
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 flex flex-wrap items-center gap-2"
      role="status"
      aria-label="État de l'auto-remplissage"
    >
      <span className="font-medium text-zinc-100 mr-1 shrink-0">Auto :</span>
      {sources.map((s) => (
        <div
          key={s.label}
          className="flex items-center gap-1.5 rounded px-2 py-1 bg-zinc-800/60 border border-zinc-700/40 min-w-0"
          title={s.hint ?? s.label}
        >
          <StateIcon state={s.state} />
          <span className="text-[11px] text-zinc-100 whitespace-nowrap">{s.label}</span>
          {s.hint && (
            <span className="text-[10px] text-zinc-400 hidden sm:inline truncate max-w-[180px]">
              {s.hint}
            </span>
          )}
        </div>
      ))}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      )}
    </div>
  );
}
