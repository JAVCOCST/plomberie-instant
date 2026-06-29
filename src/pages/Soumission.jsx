import { useMemo, useState } from "react";
import { Plus, Trash2, FileText, Check } from "lucide-react";

const TPS = 0.05; // Taxe fédérale (Québec)
const TVQ = 0.09975; // Taxe provinciale (Québec)

const money = (n) =>
  (n || 0).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });

let _id = 1;
const newItem = () => ({ id: _id++, desc: "", qty: 1, price: 0 });

export default function Soumission() {
  const [client, setClient] = useState({ name: "", address: "", email: "" });
  const [items, setItems] = useState([newItem()]);
  const [saved, setSaved] = useState(false);

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
    setItems((arr) =>
      arr.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );
    setSaved(false);
  };
  const addItem = () => setItems((arr) => [...arr, newItem()]);
  const removeItem = (id) =>
    setItems((arr) => (arr.length > 1 ? arr.filter((it) => it.id !== id) : arr));

  const save = () => {
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

      {/* Infos client */}
      <section className="card-block">
        <h2 className="block-title">Client</h2>
        <div className="client-grid">
          <div className="fld">
            <label>Nom</label>
            <input
              value={client.name}
              onChange={(e) => setClient({ ...client, name: e.target.value })}
              placeholder="Nom du client"
            />
          </div>
          <div className="fld">
            <label>Courriel</label>
            <input
              value={client.email}
              onChange={(e) => setClient({ ...client, email: e.target.value })}
              placeholder="client@exemple.com"
            />
          </div>
          <div className="fld fld-wide">
            <label>Adresse des travaux</label>
            <input
              value={client.address}
              onChange={(e) => setClient({ ...client, address: e.target.value })}
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
                    value={it.desc}
                    onChange={(e) => updateItem(it.id, "desc", e.target.value)}
                    placeholder="Ex: Remplacement chauffe-eau 40 gal"
                  />
                </td>
                <td className="num qcol">
                  <input
                    className="cell-input num"
                    type="number"
                    min="0"
                    value={it.qty}
                    onChange={(e) => updateItem(it.id, "qty", e.target.value)}
                  />
                </td>
                <td className="num pcol">
                  <input
                    className="cell-input num"
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.price}
                    onChange={(e) => updateItem(it.id, "price", e.target.value)}
                  />
                </td>
                <td className="num line-amount">
                  {money((Number(it.qty) || 0) * (Number(it.price) || 0))}
                </td>
                <td className="acol">
                  <button
                    className="icon-del"
                    onClick={() => removeItem(it.id)}
                    aria-label="Supprimer la ligne"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Totaux */}
      <section className="totals-row">
        <div className="totals-box">
          <div className="t-line">
            <span>Sous-total</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          <div className="t-line">
            <span>TPS (5 %)</span>
            <span>{money(totals.tps)}</span>
          </div>
          <div className="t-line">
            <span>TVQ (9,975 %)</span>
            <span>{money(totals.tvq)}</span>
          </div>
          <div className="t-line t-total">
            <span>Total</span>
            <span>{money(totals.total)}</span>
          </div>
          <button className="save-btn" onClick={save}>
            {saved ? (
              <>
                <Check size={16} /> Enregistrée
              </>
            ) : (
              <>
                <FileText size={16} /> Enregistrer la soumission
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
