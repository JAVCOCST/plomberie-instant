import { useEffect, useMemo, useState } from "react";
import {
  Search, Loader2, MapPin, Navigation, Plus, X, Camera, Image as ImageIcon,
  Inbox, Wrench, CheckCircle2, FolderKanban, Calendar, Truck, Trash2, Clock,
} from "lucide-react";
import { supabase } from "../supabaseClient";

const gps = (addr) =>
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`, "_blank", "noopener");

// Statut affiché : à dispatcher (gris) · en cours (jaune) · terminé (rouge)
const STATUS = {
  adispatcher: { label: "À dispatcher", icon: Inbox },
  encours: { label: "En cours", icon: Wrench },
  termine: { label: "Terminé", icon: CheckCircle2 },
};
const ORDER = ["adispatcher", "encours", "termine"];

export default function Projets() {
  const [projets, setProjets] = useState([]);
  const [counts, setCounts] = useState({});
  const [plombiers, setPlombiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("tous");
  const [modal, setModal] = useState(null); // "new" | project
  const [dispatchFor, setDispatchFor] = useState(null);
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    const [pr, as, pl] = await Promise.all([
      supabase.from("pi_projets").select("*").order("created_at", { ascending: false }),
      supabase.from("pi_assignations").select("projet_id"),
      supabase.from("pi_plombiers").select("id,name").order("created_at"),
    ]);
    const c = {};
    (as.data || []).forEach((a) => { c[a.projet_id] = (c[a.projet_id] || 0) + 1; });
    setCounts(c);
    setProjets(pr.data || []);
    setPlombiers(pl.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const terminer = async (p) => {
    setBusy(p.id);
    await supabase.from("pi_projets").update({ status: "termine", finished_at: new Date().toISOString() }).eq("id", p.id);
    setBusy(""); load();
  };
  const supprimer = async (p) => {
    if (!window.confirm(`Supprimer définitivement « ${p.name} » ? Les affectations au dispatch seront retirées. Cette action est irréversible.`)) return;
    setBusy(p.id);
    const { error } = await supabase.from("pi_projets").delete().eq("id", p.id);
    setBusy("");
    if (error) { window.alert("Échec de la suppression : " + error.message); return; }
    load();
  };

  const statusOf = (p) =>
    p.status === "termine" ? "termine" : counts[p.id] ? "encours" : "adispatcher";

  const withStatus = useMemo(
    () => projets.map((p) => ({ ...p, _status: statusOf(p) })),
    [projets, counts]
  );

  const tally = useMemo(() => {
    const t = { adispatcher: 0, encours: 0, termine: 0 };
    withStatus.forEach((p) => { t[p._status]++; });
    return t;
  }, [withStatus]);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return withStatus.filter((p) => {
      if (filter !== "tous" && p._status !== filter) return false;
      if (!n) return true;
      return p.name?.toLowerCase().includes(n) || (p.address || "").toLowerCase().includes(n);
    });
  }, [withStatus, q, filter]);

  return (
    <div className="page projets-page">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Projets</h1>
          <p className="page-sub">Tous tes projets, par statut — à dispatcher, en cours et terminés</p>
        </div>
        <button className="save-btn" style={{ width: "auto" }} onClick={() => setModal("new")}>
          <Plus size={16} /> Nouveau projet
        </button>
      </div>

      {/* Tuiles résumé */}
      <div className="proj-stats">
        {ORDER.map((k) => {
          const Icon = STATUS[k].icon;
          return (
            <button key={k} className={`proj-stat ${k} ${filter === k ? "active" : ""}`}
              onClick={() => setFilter(filter === k ? "tous" : k)}>
              <span className="proj-stat-ico"><Icon size={18} /></span>
              <span className="proj-stat-num">{tally[k]}</span>
              <span className="proj-stat-lbl">{STATUS[k].label}</span>
            </button>
          );
        })}
      </div>

      <div className="cat-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un projet, une adresse…" />
        </div>
        <div className="proj-filter">
          <button className={filter === "tous" ? "active" : ""} onClick={() => setFilter("tous")}>Tous</button>
          {ORDER.map((k) => (
            <button key={k} className={`${k} ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>
              {STATUS[k].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Chargement…
        </p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <FolderKanban size={34} />
          <p>Aucun projet {filter !== "tous" ? `« ${STATUS[filter].label} »` : ""} pour l'instant.</p>
        </div>
      ) : (
        <div className="proj-grid">
          {rows.map((p) => {
            const Icon = STATUS[p._status].icon;
            const photo = Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null;
            return (
              <div key={p.id} className={`proj-card ${p._status}`} onClick={() => setModal(p)}>
                <div className="proj-card-media">
                  {photo ? <img src={photo} alt="" /> : <span className="proj-card-noimg"><ImageIcon size={22} /></span>}
                  <span className={`proj-pill ${p._status}`}><Icon size={12} /> {STATUS[p._status].label}</span>
                </div>
                <div className="proj-card-body">
                  <h3 className="proj-card-name">{p.name}</h3>
                  {p.address ? (
                    <button className="proj-addr" onClick={(e) => { e.stopPropagation(); gps(p.address); }}>
                      <MapPin size={13} /> <span>{p.address}</span> <Navigation size={12} className="proj-addr-go" />
                    </button>
                  ) : <span className="proj-addr empty"><MapPin size={13} /> Aucune adresse</span>}
                  <div className="proj-card-foot">
                    {p._status === "termine" && p.finished_at
                      ? <span><Calendar size={12} /> Terminé le {new Date(p.finished_at).toLocaleDateString("fr-CA")}</span>
                      : <span><Calendar size={12} /> {counts[p.id] || 0} intervention{(counts[p.id] || 0) > 1 ? "s" : ""} planifiée{(counts[p.id] || 0) > 1 ? "s" : ""}</span>}
                  </div>
                  <div className="proj-actions" onClick={(e) => e.stopPropagation()}>
                    {p._status !== "termine" && (
                      <button className="pa-btn dispatch" onClick={() => setDispatchFor(p)} disabled={busy === p.id}>
                        <Truck size={14} /> Dispatcher
                      </button>
                    )}
                    {p._status !== "termine" && (
                      <button className="pa-btn done" onClick={() => terminer(p)} disabled={busy === p.id}>
                        <CheckCircle2 size={14} /> Terminer
                      </button>
                    )}
                    <button className="pa-btn del" onClick={() => supprimer(p)} disabled={busy === p.id} title="Supprimer" aria-label="Supprimer">
                      {busy === p.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dispatchFor && (
        <DispatchModal
          project={dispatchFor}
          plombiers={plombiers}
          onClose={() => setDispatchFor(null)}
          onDone={() => { setDispatchFor(null); load(); }}
        />
      )}

      {modal && (
        <ProjectEditor
          project={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

/* Modal : envoyer le projet au dispatch (plombier + jour + heure + durée) */
const DUREES = [
  { v: 30, l: "30 min" }, { v: 60, l: "1 h" }, { v: 90, l: "1 h 30" },
  { v: 120, l: "2 h" }, { v: 180, l: "3 h" }, { v: 240, l: "4 h" },
];

function DispatchModal({ project, plombiers, onClose, onDone }) {
  const [plombierId, setPlombierId] = useState(plombiers[0]?.id || "");
  const [jour, setJour] = useState(() => new Date().toLocaleDateString("en-CA")); // YYYY-MM-DD local
  const [heure, setHeure] = useState("08:00");
  const [duree, setDuree] = useState(60);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (!plombierId) { setErr("Choisis un plombier."); return; }
    setSaving(true);
    const { error } = await supabase.from("pi_assignations")
      .insert({ plombier_id: plombierId, projet_id: project.id, jour, heure, duree_min: duree });
    if (error) { setErr(error.message); setSaving(false); return; }
    onDone();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <Truck size={18} />
          <h2>Dispatcher le projet</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="modal-section">
          <p className="page-sub" style={{ marginTop: 0 }}><strong>{project.name}</strong></p>
          {plombiers.length === 0 ? (
            <div className="msg error">Aucun plombier. Ajoute un plombier dans le Dispatch d'abord.</div>
          ) : (
            <>
              {err && <div className="msg error" style={{ marginBottom: "0.8rem" }}>{err}</div>}
              <div className="fld" style={{ marginBottom: "0.8rem" }}>
                <label>Plombier</label>
                <select value={plombierId} onChange={(e) => setPlombierId(e.target.value)}>
                  {plombiers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="proj-disp-row">
                <div className="fld">
                  <label><Calendar size={13} /> Jour</label>
                  <input type="date" value={jour} onChange={(e) => setJour(e.target.value)} />
                </div>
                <div className="fld">
                  <label><Clock size={13} /> Heure</label>
                  <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
                </div>
              </div>
              <div className="fld" style={{ marginTop: "0.8rem" }}>
                <label>Durée</label>
                <select value={duree} onChange={(e) => setDuree(Number(e.target.value))}>
                  {DUREES.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={save} disabled={saving || plombiers.length === 0}>
            {saving ? (<><Loader2 size={16} className="spin" /> …</>) : "Placer au dispatch"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Modal création / édition d'un projet */
const PALETTE = ["#8a7e72", "#7d8471", "#a0764f", "#6d7b8d", "#8a9a5b", "#b08968"];

function ProjectEditor({ project, onClose, onSaved }) {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name || "");
  const [address, setAddress] = useState(project?.address || "");
  const [existing, setExisting] = useState(Array.isArray(project?.photos) ? project.photos : []);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (!name.trim()) { setErr("Le nom du projet est requis."); return; }
    setSaving(true);
    try {
      let id = project?.id;
      if (!isEdit) {
        const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        const { data, error } = await supabase.from("pi_projets")
          .insert({ name: name.trim(), address: address || null, color }).select().single();
        if (error) throw error;
        id = data.id;
      }
      const urls = [...existing];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `projet/${id}/${Date.now()}_${i}.${ext}`;
        const { error: upErr } = await supabase.storage.from("bons-photos").upload(path, f, { contentType: f.type });
        if (upErr) throw upErr;
        urls.push(supabase.storage.from("bons-photos").getPublicUrl(path).data.publicUrl);
      }
      const { error: uErr } = await supabase.from("pi_projets")
        .update({ name: name.trim(), address: address || null, photos: urls }).eq("id", id);
      if (uErr) throw uErr;
      onSaved();
    } catch (e) { setErr(e?.message || "Échec."); setSaving(false); }
  };

  const reactivate = async () => {
    setSaving(true);
    await supabase.from("pi_projets").update({ status: "actif", finished_at: null }).eq("id", project.id);
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <FolderKanban size={18} />
          <h2>{isEdit ? "Modifier le projet" : "Nouveau projet"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        {err && <div className="msg error" style={{ margin: "1rem 1.25rem 0" }}>{err}</div>}
        <div className="modal-section">
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Nom du projet</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Rénovation salle de bain — Laval" />
          </div>
          <div className="fld">
            <label>Adresse (GPS)</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 rue Exemple, Ville" />
          </div>
        </div>
        <div className="modal-section">
          <h3><Camera size={15} /> Photos</h3>
          <div className="photo-previews">
            {existing.map((url, i) => (
              <div className="photo-prev" key={`e${i}`}>
                <img src={url} alt="" />
                <button className="photo-rm" onClick={() => setExisting((a) => a.filter((_, k) => k !== i))} aria-label="Retirer"><X size={12} /></button>
              </div>
            ))}
            {files.map((f, i) => (
              <div className="photo-prev" key={`n${i}`}>
                <img src={URL.createObjectURL(f)} alt="" />
                <button className="photo-rm" onClick={() => setFiles((a) => a.filter((_, k) => k !== i))} aria-label="Retirer"><X size={12} /></button>
              </div>
            ))}
            <label className="emp-add-photo" style={{ height: 76 }}>
              <ImageIcon size={18} /> Ajouter
              <input type="file" accept="image/*" multiple hidden
                onChange={(e) => { setFiles((a) => [...a, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
            </label>
          </div>
        </div>
        <div className="modal-foot">
          {isEdit && project.status === "termine" && (
            <button className="btn-secondary" onClick={reactivate} disabled={saving}>Réactiver</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={save} disabled={saving}>
            {saving ? (<><Loader2 size={16} className="spin" /> Enregistrement…</>) : (isEdit ? "Enregistrer" : "Créer le projet")}
          </button>
        </div>
      </div>
    </div>
  );
}
