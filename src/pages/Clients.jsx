import { useEffect, useMemo, useState } from "react";
import { Search, Users, DownloadCloud, Loader2, Mail, Phone, MapPin, UserPlus, X, Check } from "lucide-react";
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
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("pi_clients")
      .select("*")
      .order("display_name");
    setClients(data || []);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      await load().catch(() => setLoading(false));
      runSync(true); // synchro auto silencieuse au chargement
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSync = async (silent = false) => {
    setSyncing(true);
    if (!silent) { setMsg(""); setErr(""); }
    try {
      const { data, error } = await supabase.functions.invoke("qbo-sync-clients");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!silent) setMsg(`${data?.synced ?? 0} client(s) synchronisé(s) depuis QuickBooks.`);
      await load();
    } catch (e) {
      if (!silent) setErr(`Échec de la synchronisation : ${e?.message || e}.`);
    } finally {
      setSyncing(false);
    }
  };
  const sync = () => runSync(false);

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
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className="add-primary" onClick={() => setAddOpen(true)}>
            <UserPlus size={16} /> Ajouter un client
          </button>
          <button className="btn-secondary" style={{ width: "auto" }} onClick={sync} disabled={syncing}>
            {syncing
              ? (<><Loader2 size={16} className="spin" /> Synchronisation…</>)
              : (<><DownloadCloud size={16} /> Synchroniser</>)}
          </button>
        </div>
      </div>

      {addOpen && (
        <ClientModal
          onClose={() => setAddOpen(false)}
          onCreated={(name) => { setAddOpen(false); setMsg(`Client « ${name} » créé dans QuickBooks.`); load(); }}
        />
      )}

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

/* Modal : créer un client (dans QuickBooks + l'app) */
function ClientModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const create = async () => {
    setErr("");
    if (!name.trim()) { setErr("Le nom du client est requis."); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("qbo-create-customer", {
        body: { display_name: name.trim(), company_name: company, email, phone, address },
      });
      if (error) {
        let code = error.message;
        try { const j = await error.context.json(); code = j.error || code; } catch { /* ignore */ }
        setErr(code === "nom_deja_utilise" ? "Ce nom de client existe déjà dans QuickBooks."
          : code === "not_connected" ? "QuickBooks n'est pas connecté."
          : "Échec : " + code);
        setSaving(false);
        return;
      }
      onCreated(data.display_name || name.trim());
    } catch (e) {
      setErr("Échec : " + (e?.message || e)); setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <UserPlus size={18} />
          <h2>Nouveau client</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        {err && <div className="msg error" style={{ margin: "1rem 1.25rem 0" }}>{err}</div>}
        <div className="modal-section">
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Nom du client <span className="req-star">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Jean Tremblay ou 9339-5853 Québec Inc" />
          </div>
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Entreprise (optionnel)</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Courriel (optionnel)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.com" />
          </div>
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Téléphone (optionnel)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="fld">
            <label>Adresse (optionnel)</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 rue Exemple, Ville" />
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={create} disabled={saving}>
            {saving ? (<><Loader2 size={16} className="spin" /> Création…</>) : (<><Check size={16} /> Créer le client</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
