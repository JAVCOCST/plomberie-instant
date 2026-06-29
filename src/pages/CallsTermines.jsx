import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw, MapPin, Loader2, Search } from "lucide-react";
import { supabase } from "../supabaseClient";

export default function CallsTermines() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("pi_projets")
      .select("*")
      .eq("status", "termine")
      .order("finished_at", { ascending: false });
    setCalls(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const reactivate = async (id) => {
    await supabase.from("pi_projets").update({ status: "actif", finished_at: null }).eq("id", id);
    load();
  };

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return calls;
    return calls.filter((c) => c.name?.toLowerCase().includes(n) || (c.address || "").toLowerCase().includes(n));
  }, [calls, q]);

  return (
    <div className="page bons">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Calls terminés</h1>
          <p className="page-sub">Archive des projets complétés (retirés du dispatch)</p>
        </div>
      </div>

      <div className="cat-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un call terminé…" />
        </div>
      </div>

      {loading ? (
        <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Chargement…
        </p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <CheckCircle2 size={34} />
          <p>Aucun call terminé pour l'instant.</p>
        </div>
      ) : (
        <div className="bon-grid">
          {rows.map((c) => (
            <div className="bon-card" key={c.id}>
              <div className="bon-card-head">
                <span className="bon-pl">
                  <span className="proj-dot" style={{ background: c.color }} /> {c.name}
                </span>
              </div>
              <div className="bon-meta">
                {c.address && <span><MapPin size={12} /> {c.address}</span>}
                {c.finished_at && <span>Terminé le {new Date(c.finished_at).toLocaleDateString("fr-CA")}</span>}
              </div>
              {Array.isArray(c.photos) && c.photos.length > 0 && (
                <div className="bon-photos">
                  {c.photos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer"><img src={url} alt="" /></a>
                  ))}
                </div>
              )}
              <button className="btn-secondary" style={{ width: "auto", marginTop: "0.6rem" }} onClick={() => reactivate(c.id)}>
                <RotateCcw size={15} /> Réactiver
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
