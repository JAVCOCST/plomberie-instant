import { useEffect, useMemo, useState } from "react";
import { Search, Users, DownloadCloud, Loader2, Mail, Phone, MapPin } from "lucide-react";
import { supabase } from "../supabaseClient";

function money(n) {
  return n == null
    ? "—"
    : Number(n).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("pi_clients")
      .select("*")
      .order("display_name");
    setClients(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const sync = async () => {
    setSyncing(true);
    setMsg("");
    setErr("");
    try {
      const { data, error } = await supabase.functions.invoke("qbo-sync-clients");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMsg(`${data?.synced ?? 0} client(s) synchronisé(s) depuis QuickBooks.`);
      await load();
    } catch (e) {
      setErr(`Échec de la synchronisation : ${e?.message || e}.`);
    } finally {
      setSyncing(false);
    }
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (c) =>
        c.display_name?.toLowerCase().includes(needle) ||
        c.company_name?.toLowerCase().includes(needle) ||
        c.email?.toLowerCase().includes(needle) ||
        c.phone?.toLowerCase().includes(needle)
    );
  }, [clients, q]);

  return (
    <div className="page clients">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">Importés de QuickBooks</p>
        </div>
        <button className="add-primary" onClick={sync} disabled={syncing}>
          {syncing
            ? (<><Loader2 size={16} className="spin" /> Synchronisation…</>)
            : (<><DownloadCloud size={16} /> Synchroniser depuis QuickBooks</>)}
        </button>
      </div>

      {msg && <div className="msg success" style={{ maxWidth: 560 }}>{msg}</div>}
      {err && <div className="msg error" style={{ maxWidth: 560 }}>{err}</div>}

      <div className="cat-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un client (nom, courriel, téléphone)…"
          />
        </div>
      </div>

      <div className="cat-table-wrap">
        <table className="cat-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Entreprise</th>
              <th>Courriel</th>
              <th>Téléphone</th>
              <th>Adresse</th>
              <th className="num">Solde</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="cat-empty"><Loader2 size={16} className="spin" /> Chargement…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="cat-empty">
                {clients.length === 0
                  ? "Aucun client. Clique « Synchroniser depuis QuickBooks »."
                  : "Aucun résultat."}
              </td></tr>
            ) : (
              rows.map((c) => (
                <tr key={c.qbo_id}>
                  <td className="cat-name">
                    <Users size={15} className="cat-name-icon" />
                    {c.display_name}
                  </td>
                  <td className="cat-desc">{c.company_name || "—"}</td>
                  <td>{c.email ? <a href={`mailto:${c.email}`} className="cl-link"><Mail size={13} /> {c.email}</a> : "—"}</td>
                  <td>{c.phone ? <span className="cl-link"><Phone size={13} /> {c.phone}</span> : "—"}</td>
                  <td className="cat-desc">{c.address ? <span className="cl-link"><MapPin size={13} /> {c.address}</span> : "—"}</td>
                  <td className="num">{money(c.balance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="cat-foot">
        {!loading && `${rows.length} client${rows.length > 1 ? "s" : ""}`}
      </p>
    </div>
  );
}
