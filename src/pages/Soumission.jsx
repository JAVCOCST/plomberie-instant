import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, FileText, Check, Search } from "lucide-react";
import { supabase } from "../supabaseClient";

const TPS = 0.05; // Taxe fédérale (Québec)
const TVQ = 0.09975; // Taxe provinciale (Québec)

const money = (n) =>
  (n || 0).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });

let _id = 1;
const newItem = () => ({ id: _id++, desc: "", qty: 1, price: 0 });

export default function Soumission() {
  const [client, setClient] = useState({ name: "", address: "", email: "" });
  const [clientPick, setClientPick] = useState("");
  const [clients, setClients] = useState([]);
  const [produits, setProduits] = useState([]);
  const [items, setItems] = useState([newItem()]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("pi_clients").select("display_name,email,address").order("display_name")
      .then(({ data }) => setClients(data || []));
    supabase.from("pi_produits").select("name,unit_price").order("name")
      .then(({ data }) => setProduits(data || []));
  }, []);

  const priceByName = useMemo(() => {
    const m = {};
    produits.forEach((p) => { m[p.name] = p.unit_price; });
    return m;
  }, [produits]);

  // Choix d'un client QuickBooks → auto-remplit les champs
  const onClientPick = (value) => {
    setClientPick(value);
    setSaved(false);
    const c = clients.find((x) => x.display_name === value);
    if (c) {
      setClient({
        name: c.display_name,
        email: c.email || "",
        address: c.address || "",
      });
    }
  };

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0),
      0
    );
    const tps = subtotal * TPS;
    const tvq = subtotal * TVQ;
    return { subtotal, tps, tvq, total: subtotal + tps + tvq };
  }, [items]);

  const updateItem = (id, field, value) => {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
    setSaved(false);
  };
  const onDescChange = (id, value) => {
    setItems((arr) =>
      arr.map((it) => {
        if (it.id !== id) return it;
        const matched = priceByName[value];
        return matched != null ? { ...it, desc: value, price: matched } : { ...it, desc: value };
      })
    );
    setSaved(false);
  };
  const addItem = () => setItems((arr) => [...arr, newItem()]);
  const removeItem = (id) =>
    setItems((arr) => (arr.length > 1 ? arr.filter((it) => it.id !== id) : arr));

  const save = () => {
    setError("");
    if (!client.name.trim()) {
      setError("Le client est obligatoire.");
      return;
    }
    const record = {
      id: `S-${Date.now()}`,
      client,
      items,
      totals,
      date: new Date().toISOString(),
    };
    try {
      const list = JSON.parse(localStorage.getItem("pi_soumissions") || "[]");
      list.push(record);
      localStorage.setItem("pi_soumissions", JSON.stringify(list));
    } catch {
      /* ignore */
    }
    setSaved(true);
  };

  return (
    <div className="page soumission">
      <h1 className="page-title">Nouvelle soumission</h1>
      <p className="page-sub">Devis pour un client — taxes Québec incluses</p>

      {error && <div className="msg error" style={{ maxWidth: 560, marginTop: "1rem" }}>{error}</div>}

      {/* Infos client */}
      <section className="card-block">
        <h2 className="block-title">Client <span className="req-star">*</span></h2>

        <div className="fld" style={{ marginBottom: "0.9rem" }}>
          <label><Search size={13} /> Client QuickBooks</label>
          <input
            list="pi-clients-list-soum"
            value={clientPick}
            onChange={(e) => onClientPick(e.target.value)}
            placeholder="Rechercher un client existant…"
          />
          <datalist id="pi-clients-list-soum">
            {clients.map((c, i) => <option key={i} value={c.display_name} />)}
          </datalist>
          <span className="field-hint" style={{ color: "var(--muted)" }}>
            Choisis un client existant, ou saisis un nouveau client ci-dessous.
          </span>
        </div>

        <div className="client-grid">
          <div className="fld">
            <label>Nom</label>
            <input
              value={client.name}
              onChange={(e) => { setClient({ ...client, name: e.target.value }); setSaved(false); }}
              placeholder="Nom du client"
            />
          </div>
          <div className="fld">
            <label>Courriel</label>
            <input
              value={client.email}
              onChange={(e) => { setClient({ ...client, email: e.target.value }); setSaved(false); }}
              placeholder="client@exemple.com"
            />
          </div>
          <div className="fld fld-wide">
            <label>Adresse des travaux</label>
            <input
              value={client.address}
              onChange={(e) => { setClient({ ...client, address: e.target.value }); setSaved(false); }}
              placeholder="123 rue Exemple, Ville"
            />
          </div>
        </div>
      </section>

      {/* Lignes d'articles */}
      <section className="card-block">
        <div className="block-head">
          <h2 className="block-title">Articles & services</h2>
          <button className="mini-add" onClick={addItem}>
            <Plus size={16} /> Ajouter une ligne
          </button>
        </div>

        <table className="quote-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="num qcol">Qté</th>
              <th className="num pcol">Prix unit.</th>
              <th className="num">Montant</th>
              <th className="acol"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>
                  <input
                    className="cell-input"
                    list="pi-produits-list-soum"
                    value={it.desc}
                    onChange={(e) => onDescChange(it.id, e.target.value)}
                    placeholder="Choisir un produit / service…"
                  />
                </td>
                <td className="num qcol">
                  <input className="cell-input num" type="number" min="0" value={it.qty}
                    onChange={(e) => updateItem(it.id, "qty", e.target.value)} />
                </td>
                <td className="num pcol">
                  <input className="cell-input num" type="number" min="0" step="0.01" value={it.price}
                    onChange={(e) => updateItem(it.id, "price", e.target.value)} />
                </td>
                <td className="num line-amount">
                  {money((Number(it.qty) || 0) * (Number(it.price) || 0))}
                </td>
                <td className="acol">
                  <button className="icon-del" onClick={() => removeItem(it.id)} aria-label="Supprimer la ligne">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="pi-produits-list-soum">
          {produits.map((p, i) => <option key={i} value={p.name} />)}
        </datalist>
      </section>

      {/* Totaux */}
      <section className="totals-row">
        <div className="totals-box">
          <div className="t-line"><span>Sous-total</span><span>{money(totals.subtotal)}</span></div>
          <div className="t-line"><span>TPS (5 %)</span><span>{money(totals.tps)}</span></div>
          <div className="t-line"><span>TVQ (9,975 %)</span><span>{money(totals.tvq)}</span></div>
          <div className="t-line t-total"><span>Total</span><span>{money(totals.total)}</span></div>
          <button className="save-btn" onClick={save}>
            {saved ? (<><Check size={16} /> Enregistrée</>) : (<><FileText size={16} /> Enregistrer la soumission</>)}
          </button>
        </div>
      </section>
    </div>
  );
}
