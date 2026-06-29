import { useEffect, useMemo, useState } from "react";
import { Search, Package, Database, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";

// Données d'exemple (repli tant que QuickBooks n'a rien synchronisé)
const SAMPLE = [
  { name: "Main-d'œuvre plombier", type: "Service", description: "Taux horaire standard", salesPrice: 95, qtyOnHand: null },
  { name: "Chauffe-eau 40 gal", type: "Inventory", description: "Réservoir électrique 40 gallons", salesPrice: 689, qtyOnHand: 8 },
  { name: "Robinet de cuisine", type: "Inventory", description: "Robinet monocommande chromé", salesPrice: 179, qtyOnHand: 23 },
  { name: "Valve d'arrêt 1/4 tour", type: "NonInventory", description: "Valve d'arrêt laiton 1/2 po", salesPrice: 14.5, qtyOnHand: null },
];

const TYPE_LABEL = {
  Service: "Service",
  Inventory: "Inventaire",
  NonInventory: "Non-inventaire",
};
const TYPES = ["Tous", "Service", "Inventory", "NonInventory"];

function money(n) {
  return n == null
    ? "—"
    : Number(n).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
}

export default function Catalogue() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("Tous");
  const [items, setItems] = useState([]);
  const [fromQbo, setFromQbo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("pi_produits")
        .select("name, type, description, unit_price, qty_on_hand")
        .order("name");
      if (data && data.length > 0) {
        setItems(
          data.map((p) => ({
            name: p.name,
            type: p.type || "NonInventory",
            description: p.description || "",
            salesPrice: p.unit_price,
            qtyOnHand: p.qty_on_hand,
          }))
        );
        setFromQbo(true);
      } else {
        setItems(SAMPLE);
        setFromQbo(false);
      }
      setLoading(false);
    })().catch(() => {
      setItems(SAMPLE);
      setLoading(false);
    });
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((p) => {
      if (type !== "Tous" && p.type !== type) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.description || "").toLowerCase().includes(needle)
      );
    });
  }, [items, q, type]);

  return (
    <div className="page catalogue">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Catalogue produits</h1>
          <p className="page-sub">Produits & services de Plomberie Instant</p>
        </div>
        <span className={`qb-badge ${fromQbo ? "" : "muted"}`}>
          <Database size={14} />
          {fromQbo ? "Synchronisé avec QuickBooks" : "Synchronisable avec QuickBooks"}
        </span>
      </div>

      <div className="cat-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un produit ou service…"
          />
        </div>
        <div className="type-filters">
          {TYPES.map((t) => (
            <button
              key={t}
              className={`type-pill ${type === t ? "active" : ""}`}
              onClick={() => setType(t)}
            >
              {t === "Tous" ? "Tous" : TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="cat-table-wrap">
        <table className="cat-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Description</th>
              <th className="num">Prix</th>
              <th className="num">Qté en stock</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="cat-empty"><Loader2 size={16} className="spin" /> Chargement…</td></tr>
            ) : (
              rows.map((p, i) => (
                <tr key={i}>
                  <td className="cat-name">
                    <Package size={15} className="cat-name-icon" />
                    {p.name}
                  </td>
                  <td>
                    <span className={`type-tag t-${p.type}`}>{TYPE_LABEL[p.type] || p.type}</span>
                  </td>
                  <td className="cat-desc">{p.description}</td>
                  <td className="num">{money(p.salesPrice)}</td>
                  <td className="num">{p.qtyOnHand == null ? "—" : p.qtyOnHand}</td>
                </tr>
              ))
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="cat-empty">Aucun résultat.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="cat-foot">
        {loading ? "" : `${rows.length} article${rows.length > 1 ? "s" : ""} affiché${rows.length > 1 ? "s" : ""}`}
        {!loading && !fromQbo && " · données d'exemple — lance une synchro dans Intégration QuickBooks."}
        {!loading && fromQbo && " · synchronisés depuis QuickBooks."}
      </p>
    </div>
  );
}
