/**
 * AdminSolarViewer
 * ────────────────
 * Wrapper React pour le viewer 3D Solar autonome (three.js + WebGL).
 *
 * Le HTML du viewer est importé EN STRING au build time via Vite ?raw,
 * puis injecté dans <iframe srcDoc={...}>. Ça contourne tout routing
 * Vercel / static-file serving — l'iframe rend le HTML directement
 * depuis la mémoire du bundle, plus aucun fetch HTTP.
 *
 * Le viewer charge three.js depuis esm.sh (autorisé par la CSP) et
 * contient ses propres données (383 Provence inlinées).
 */
import { ExternalLink, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
// @ts-expect-error Vite ?raw : importe le HTML comme string brute
import viewerHtml from "../../public/admin/solar-viewer.html?raw";

export default function AdminSolarViewer() {
  const openInNewTab = () => {
    const win = window.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(viewerHtml as string);
      win.document.close();
    }
  };

  return (
    <div className="fixed inset-0 top-14 bg-[#0f1116] text-zinc-200">
      {/* Header */}
      <div className="absolute top-0 inset-x-0 h-12 bg-[#171a23] border-b border-[#272b3a] flex items-center px-4 gap-3 z-10">
        <Sun className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium">Solar 3D viewer · 383 Provence</span>
        <span className="text-xs text-zinc-500 ml-2">
          (6 plans Solar + DSM + ground truth humain)
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs bg-[#1f2330] border-[#272b3a] hover:bg-[#272b3a]"
          onClick={openInNewTab}
        >
          <ExternalLink className="w-3 h-3 mr-1" />
          Ouvrir dans un nouvel onglet
        </Button>
      </div>

      {/* Iframe viewer via srcDoc — HTML inlined depuis le bundle */}
      <iframe
        srcDoc={viewerHtml as string}
        title="Solar 3D viewer"
        className="absolute inset-0 top-12 w-full border-0"
        style={{ height: "calc(100% - 48px)" }}
      />
    </div>
  );
}
