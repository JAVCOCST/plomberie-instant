import { useEffect, useState } from "react";
import { Database, Plug, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "../supabaseClient";

export default function QuickBooks() {
  const [status, setStatus] = useState("loading"); // loading | connected | disconnected
  const [company, setCompany] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("pi_qbo_status")
        .select("realm_id, company_name, updated_at")
        .limit(1)
        .maybeSingle();
      if (data) {
        setCompany(data);
        setStatus("connected");
      } else {
        setStatus("disconnected");
      }
    })().catch(() => setStatus("disconnected"));
  }, []);

  const connect = () => {
    // Démarre le flux OAuth via l'Edge Function (à venir)
    const base = "https://rnfwtloheitkhbnovgch.supabase.co/functions/v1";
    window.location.href = `${base}/qbo-connect`;
  };

  return (
    <div className="page qb-page">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Intégration QuickBooks</h1>
          <p className="page-sub">Synchronise tes produits, services et données comptables</p>
        </div>
        <span className="qb-badge"><Database size={14} /> Intuit QuickBooks</span>
      </div>

      <div className="qb-box">
        {status === "loading" ? (
          <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 size={16} className="spin" /> Vérification du statut…
          </p>
        ) : status === "connected" ? (
          <>
            <div className="qb-state ok">
              <CheckCircle2 size={20} />
              <div>
                <strong>Connecté à QuickBooks</strong>
                <p>{company?.company_name || "Compagnie liée"}</p>
              </div>
            </div>
            <button className="add-primary" onClick={connect}>
              <RefreshCw size={16} /> Reconnecter / rafraîchir
            </button>
          </>
        ) : (
          <>
            <div className="qb-state">
              <Plug size={20} />
              <div>
                <strong>Non connecté</strong>
                <p>Connecte le compte QuickBooks de Plomberie Instant pour importer ton catalogue.</p>
              </div>
            </div>
            <button className="add-primary" onClick={connect}>
              <Plug size={16} /> Connecter QuickBooks
            </button>
          </>
        )}
      </div>

      <p className="cat-foot">
        En te connectant, tu autorises Plomberie Instant à accéder à tes données
        QuickBooks. Voir notre{" "}
        <a href="/confidentialite">politique de confidentialité</a>.
      </p>
    </div>
  );
}
