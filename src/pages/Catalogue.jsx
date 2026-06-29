import { useMemo, useState } from "react";
import { Search, Package, Database } from "lucide-react";

// Données d'exemple (plomberie). Structure alignée sur QuickBooks
// (name, type, description, salesPrice, qtyOnHand) → remplaçables tel quel
// par la liste produits/services QuickBooks une fois le connecteur branché.
const SAMPLE = [
  { name: "Main-d'œuvre plombier", type: "Service", description: "Taux horaire standard", salesPrice: 95, qtyOnHand: null },
  { name: "Main-d'œuvre — urgence", type: "Service", description: "Appel d'urgence / soir & fin de semaine", salesPrice: 145, qtyOnHand: null },
  { name: "Inspection caméra", type: "Service", description: "Inspection de drain par caméra", salesPrice: 250, qtyOnHand: null },
  { name: "Chauffe-eau 40 gal", type: "Inventory", description: "Réservoir électrique 40 gallons", salesPrice: 689, qtyOnHand: 8 },
  { name: "Chauffe-eau 60 gal", type: "Inventory", description: "Réservoir électrique 60 gallons", salesPrice: 879, qtyOnHand: 5 },
  { name: "Robinet de cuisine", type: "Inventory", description: "Robinet monocommande chromé", salesPrice: 179, qtyOnHand: 23 },
  { name: "Toilette une pièce", type: "Inventory", description: "Toilette à haute efficacité 4,8 L", salesPrice: 349, qtyOnHand: 12 },
  { name: "Pompe submersible 1/3 HP", type: "Inventory", description: "Pompe de puisard 1/3 HP", salesPrice: 219, qtyOnHand: 6 },
  { name: "Tuyau PEX 1/2\" (rouleau)", type: "Inventory", description: "Rouleau PEX 1/2 po — 100 pi", salesPrice: 89, qtyOnHand: 40 },
  { name: "Valve d'arrêt 1/4 tour", type: "NonInventory", description: "Valve d'arrêt laiton 1/2 po", salesPrice: 14.5, qtyOnHand: null },
  { name: "Cartouche de scellant", type: "NonInventory", description: "Scellant silicone pour plomberie", salesPrice: 9.75, qtyOnHand: null },
  { name: "Anode de magnésium", type: "NonInventory", description: "Anode de remplacement chauffe-eau", salesPrice: 34, qtyOnHand: null },
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
    : n.toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
}

export default function Catalogue() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("Tous");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SAMPLE.filter((p) => {
      if (type !== "Tous" && p.type !== type) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        (p.description || "").toLowerCase().includes(needle)
      );
    });
  }, [q, type]);

  return (
    <div className="page catalogue">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Catalogue produits</h1>
          <p className="page-sub">Produits & services de Plomberie Instant</p>
        </div>
        <span className="qb-badge">
          <Database size={14} /> Synchronisable avec QuickBooks
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
            {rows.map((p, i) => (
              <tr key={i}>
                <td className="cat-name">
                  <Package size={15} className="cat-name-icon" />
                  {p.name}
                </td>
                <td>
                  <span className={`type-tag t-${p.type}`}>{TYPE_LABEL[p.type]}</span>
                </td>
                <td className="cat-desc">{p.description}</td>
                <td className="num">{money(p.salesPrice)}</td>
                <td className="num">{p.qtyOnHand == null ? "—" : p.qtyOnHand}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="cat-empty">Aucun résultat.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="cat-foot">
        {rows.length} article{rows.length > 1 ? "s" : ""} affiché
        {rows.length > 1 ? "s" : ""} · données d'exemple en attendant la
        connexion QuickBooks.
      </p>
    </div>
  );
}
