import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Database, Plug, CheckCircle2, Loader2, RefreshCw, DownloadCloud } from "lucide-react";
import { supabase } from "../supabaseClient";

export default function QuickBooks() {
  const [status, setStatus] = useState("loading"); // loading | connected | disconnected
  const [company, setCompany] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [params, setParams] = useSearchParams();

  const loadStatus = async () => {
    const { data } = await supabase
      .from("pi_qbo_status")
      .select("realm_id, company_name, updated_at")
      .limit(1)
      .maybeSingle();
    if (data?.realm_id) {
      setCompany(data);
      setStatus("connected");
    } else {
      setStatus("disconnected");
    }
  };

  useEffect(() => {
    loadStatus().catch(() => setStatus("disconnected"));
    // Messages de retour OAuth
    if (params.get("connected")) setMsg("Connexion à QuickBooks réussie.");
    const e = params.get("error");
    if (e) setErr(`Échec de la connexion QuickBooks (${e}).`);
    if (params.get("connected") || params.get("error")) {
      params.delete("connected");
      params.delete("error");
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = () => {
    window.location.href =
      "https://rnfwtloheitkhbnovgch.supabase.co/functions/v1/qbo-connect";
  };

  const sync = async () => {
    setSyncing(true);
    setMsg("");
    setErr("");
    try {
      const { data, error } = await supabase.functions.invoke("qbo-sync");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMsg(`${data?.synced ?? 0} produit(s)/service(s) synchronisé(s) depuis QuickBooks.`);
    } catch (e) {
      setErr(`Échec de la synchronisation : ${e?.message || e}.`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="page qb-page">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Intégration QuickBooks</h1>
          <p className="page-sub">Synchronise tes produits et services depuis QuickBooks</p>
        </div>
        <span className="qb-badge"><Database size={14} /> Intuit QuickBooks</span>
      </div>

      {msg && <div className="msg success" style={{ maxWidth: 560 }}>{msg}</div>}
      {err && <div className="msg error" style={{ maxWidth: 560 }}>{err}</div>}

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
            <div className="qb-actions">
              <button className="add-primary" onClick={sync} disabled={syncing}>
                {syncing
                  ? (<><Loader2 size={16} className="spin" /> Synchronisation…</>)
                  : (<><DownloadCloud size={16} /> Synchroniser les produits</>)}
              </button>
              <button className="btn-secondary qb-reconnect" onClick={connect}>
                <RefreshCw size={16} /> Reconnecter
              </button>
            </div>
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
        Besoin d'aide ? Écris à{" "}
        <a href="mailto:info@plomberieinstant.net">info@plomberieinstant.net</a>. Voir notre{" "}
        <a href="/confidentialite">politique de confidentialité</a>.
      </p>
    </div>
  );
}
