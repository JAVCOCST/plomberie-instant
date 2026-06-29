import { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, X, Camera, Loader2, ClipboardCheck, Clock, Image as ImageIcon,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { money, fmtHours } from "../lib/time";

let _id = 1;
const newItem = () => ({ id: _id++, desc: "", qty: 1, price: 0 });

function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function BonsTravail() {
  const [bons, setBons] = useState([]);
  const [plombiers, setPlombiers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [b, pl, pr] = await Promise.all([
      supabase.from("pi_bons_travail").select("*").order("created_at", { ascending: false }),
      supabase.from("pi_plombiers").select("id,name").order("created_at"),
      supabase.from("pi_projets").select("id,name,color").order("created_at"),
    ]);
    setBons(b.data || []);
    setPlombiers(pl.data || []);
    setProjects(pr.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const plName = useMemo(() => Object.fromEntries(plombiers.map((p) => [p.id, p.name])), [plombiers]);
  const prName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  return (
    <div className="page bons">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Bons de travail</h1>
          <p className="page-sub">Rempli par le plombier après chaque job — alimente ses ventes</p>
        </div>
        <button className="add-primary" onClick={() => setFormOpen(true)}>
          <Plus size={16} /> Nouveau bon de travail
        </button>
      </div>

      {loading ? (
        <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Chargement…
        </p>
      ) : bons.length === 0 ? (
        <div className="empty-state">
          <ClipboardCheck size={34} />
          <p>Aucun bon de travail pour l'instant.</p>
        </div>
      ) : (
        <div className="bon-grid">
          {bons.map((b) => (
            <div className="bon-card" key={b.id}>
              <div className="bon-card-head">
                <span className="bon-pl">{plName[b.plombier_id] || "—"}</span>
                <span className="bon-total">{money(b.total)}</span>
              </div>
              <div className="bon-meta">
                <span>{b.jour}</span>
                {b.projet_id && <span className="bon-proj">{prName[b.projet_id]}</span>}
                <span className="bon-h"><Clock size={13} /> {fmtHours(Number(b.heures))}</span>
              </div>
              {Array.isArray(b.items) && b.items.length > 0 && (
                <ul className="bon-items">
                  {b.items.map((it, i) => (
                    <li key={i}>
                      <span>{it.qty} × {it.desc}</span>
                      <span>{money((Number(it.qty) || 0) * (Number(it.price) || 0))}</span>
                    </li>
                  ))}
                </ul>
              )}
              {Array.isArray(b.photos) && b.photos.length > 0 && (
                <div className="bon-photos">
                  {b.photos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`photo ${i + 1}`} />
                    </a>
                  ))}
                </div>
              )}
              {b.notes && <p className="bon-notes">{b.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <BonForm
          plombiers={plombiers}
          projects={projects}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}

/* ---------------- Formulaire de bon de travail ---------------- */
function BonForm({ plombiers, projects, onClose, onSaved }) {
  const [plombierId, setPlombierId] = useState("");
  const [projetId, setProjetId] = useState("");
  const [jour, setJour] = useState(todayIso());
  const [heures, setHeures] = useState(0);
  const [items, setItems] = useState([newItem()]);
  const [photos, setPhotos] = useState([]); // File[]
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [produits, setProduits] = useState([]);

  useEffect(() => {
    supabase
      .from("pi_produits")
      .select("name, unit_price")
      .order("name")
      .then(({ data }) => setProduits(data || []));
  }, []);

  const priceByName = useMemo(() => {
    const m = {};
    produits.forEach((p) => { m[p.name] = p.unit_price; });
    return m;
  }, [produits]);

  // Sélection d'un produit du catalogue → remplit le prix automatiquement
  const onDescChange = (id, value) => {
    setItems((arr) =>
      arr.map((it) => {
        if (it.id !== id) return it;
        const matched = priceByName[value];
        return matched != null
          ? { ...it, desc: value, price: matched }
          : { ...it, desc: value };
      })
    );
  };

  const total = useMemo(
    () => items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0),
    [items]
  );

  const updateItem = (id, field, value) =>
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  const addItem = () => setItems((arr) => [...arr, newItem()]);
  const removeItem = (id) =>
    setItems((arr) => (arr.length > 1 ? arr.filter((it) => it.id !== id) : arr));

  const onPickPhotos = (e) => {
    const files = Array.from(e.target.files || []);
    setPhotos((prev) => [...prev, ...files]);
    e.target.value = "";
  };
  const removePhoto = (idx) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    setError("");
    if (!plombierId) return setError("Sélectionne le plombier.");
    if (photos.length < 2) return setError("Au moins 2 photos du travail sont requises.");
    setSaving(true);
    try {
      // 1) Upload des photos
      const urls = [];
      for (let i = 0; i < photos.length; i++) {
        const f = photos[i];
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${plombierId}/${Date.now()}_${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("bons-photos").upload(path, f, { upsert: false, contentType: f.type });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("bons-photos").getPublicUrl(path);
        urls.push(data.publicUrl);
      }
      // 2) Insertion du bon
      const { error: insErr } = await supabase.from("pi_bons_travail").insert({
        plombier_id: plombierId,
        projet_id: projetId || null,
        jour,
        heures: Number(heures) || 0,
        items: items.map(({ desc, qty, price }) => ({ desc, qty: Number(qty) || 0, price: Number(price) || 0 })),
        total,
        photos: urls,
        notes: notes || null,
      });
      if (insErr) throw insErr;
      onSaved();
    } catch (e) {
      setError(e?.message || "Échec de l'enregistrement.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <ClipboardCheck size={20} />
          <h2>Nouveau bon de travail</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>

        {error && <div className="msg error" style={{ margin: "1rem 1.25rem 0" }}>{error}</div>}

        <div className="modal-section">
          <div className="fiche-grid">
            <div className="fld">
              <label>Plombier</label>
              <select value={plombierId} onChange={(e) => setPlombierId(e.target.value)}>
                <option value="">— Choisir —</option>
                {plombiers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="fld">
              <label>Projet (job punché)</label>
              <select value={projetId} onChange={(e) => setProjetId(e.target.value)}>
                <option value="">— Aucun —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="fld">
              <label>Date</label>
              <input type="date" value={jour} onChange={(e) => setJour(e.target.value)} />
            </div>
            <div className="fld">
              <label><Clock size={13} /> Heures travaillées</label>
              <input type="number" min="0" step="0.25" value={heures} onChange={(e) => setHeures(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="modal-section">
          <div className="block-head">
            <h3>Produits & services</h3>
            <button className="mini-add" onClick={addItem}><Plus size={15} /> Ligne</button>
          </div>
          <table className="quote-table">
            <thead>
              <tr><th>Description</th><th className="num qcol">Qté</th><th className="num pcol">Prix</th><th className="num">Montant</th><th className="acol"></th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td><input className="cell-input" list="pi-produits-list" value={it.desc} onChange={(e) => onDescChange(it.id, e.target.value)} placeholder="Choisir un produit / service…" /></td>
                  <td className="num qcol"><input className="cell-input num" type="number" min="0" value={it.qty} onChange={(e) => updateItem(it.id, "qty", e.target.value)} /></td>
                  <td className="num pcol"><input className="cell-input num" type="number" min="0" step="0.01" value={it.price} onChange={(e) => updateItem(it.id, "price", e.target.value)} /></td>
                  <td className="num line-amount">{money((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
                  <td className="acol"><button className="icon-del" onClick={() => removeItem(it.id)}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="pi-produits-list">
            {produits.map((p, i) => (
              <option key={i} value={p.name} />
            ))}
          </datalist>
          <div className="bon-total-line">Total : <strong>{money(total)}</strong></div>
        </div>

        <div className="modal-section">
          <h3><Camera size={15} /> Photos du travail <span className="req">(min. 2)</span></h3>
          <label className="photo-drop">
            <ImageIcon size={20} />
            <span>Ajouter des photos</span>
            <input type="file" accept="image/*" capture="environment" multiple onChange={onPickPhotos} hidden />
          </label>
          {photos.length > 0 && (
            <div className="photo-previews">
              {photos.map((f, i) => (
                <div className="photo-prev" key={i}>
                  <img src={URL.createObjectURL(f)} alt={`aperçu ${i + 1}`} />
                  <button className="photo-rm" onClick={() => removePhoto(i)} aria-label="Retirer"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <p className={`photo-count ${photos.length >= 2 ? "ok" : ""}`}>
            {photos.length} photo{photos.length > 1 ? "s" : ""} sélectionnée{photos.length > 1 ? "s" : ""}
          </p>
        </div>

        <div className="modal-section">
          <h3>Notes</h3>
          <textarea className="bon-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Détails du travail effectué…" rows={3} />
        </div>

        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={save} disabled={saving}>
            {saving ? (<><Loader2 size={16} className="spin" /> Enregistrement…</>) : (<><ClipboardCheck size={16} /> Enregistrer le bon</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
