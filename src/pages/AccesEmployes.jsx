import { useEffect, useMemo, useState } from "react";
import {
  UserPlus, Loader2, Check, KeyRound, X, Users, Pencil, Phone, Mail,
  Target, DollarSign, Calendar, ShieldCheck, ShieldAlert, Plus,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { money } from "../lib/time";

export default function AccesEmployes() {
  const [plombiers, setPlombiers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // "new" | plombier
  const [accountFor, setAccountFor] = useState(null); // plombier
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    const [pl, pr] = await Promise.all([
      supabase.from("pi_plombiers").select("*").order("name"),
      supabase.from("pi_profiles").select("plombier_id,role"),
    ]);
    setPlombiers(pl.data || []);
    setProfiles(pr.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const linkedIds = useMemo(
    () => new Set(profiles.filter((p) => p.role === "employee" && p.plombier_id).map((p) => p.plombier_id)),
    [profiles]
  );

  return (
    <div className="page acces">
      <div className="cat-head">
        <div>
          <h1 className="page-title">Employés</h1>
          <p className="page-sub">Ajoute tes plombiers, leurs objectifs et leur accès à l'application — tout au même endroit</p>
        </div>
        <button className="add-primary" onClick={() => setEditing("new")}>
          <Plus size={16} /> Ajouter un plombier
        </button>
      </div>

      {msg && <div className="msg success" style={{ marginBottom: "1rem" }}>{msg}</div>}

      {loading ? (
        <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Chargement…
        </p>
      ) : plombiers.length === 0 ? (
        <div className="empty-state">
          <Users size={34} />
          <p>Aucun plombier pour l'instant. Clique « Ajouter un plombier ».</p>
        </div>
      ) : (
        <div className="emp-grid">
          {plombiers.map((p) => {
            const hasAccount = linkedIds.has(p.id);
            return (
              <div className={`emp-card ${p.active === false ? "inactive" : ""}`} key={p.id}>
                <div className="emp-card-head">
                  <span className="emp-avatar-lg">{(p.name || "?").charAt(0).toUpperCase()}</span>
                  <div className="emp-card-id">
                    <strong>{p.name}</strong>
                    <span className={`emp-acc ${hasAccount ? "ok" : "no"}`}>
                      {hasAccount ? <><ShieldCheck size={12} /> Accès actif</> : <><ShieldAlert size={12} /> Aucun accès</>}
                    </span>
                  </div>
                  <button className="addr-btn set" onClick={() => setEditing(p)} title="Modifier" aria-label="Modifier"><Pencil size={14} /></button>
                </div>

                <div className="emp-card-info">
                  {p.phone && <span><Phone size={13} /> {p.phone}</span>}
                  {p.email && <span><Mail size={13} /> {p.email}</span>}
                  {p.hired_at && <span><Calendar size={13} /> Embauché le {new Date(p.hired_at).toLocaleDateString("fr-CA")}</span>}
                </div>

                <div className="emp-card-targets">
                  <div><Target size={13} /> Perf. <strong>{Number(p.weekly_target) || 0} h/sem</strong></div>
                  <div><DollarSign size={13} /> Ventes <strong>{money(Number(p.weekly_sales_target) || 0)}/sem</strong></div>
                </div>

                <div className="emp-card-foot">
                  {hasAccount ? (
                    <span className="emp-acc-done"><Check size={14} /> Compte de connexion créé</span>
                  ) : (
                    <button className="btn-secondary" style={{ width: "auto" }} onClick={() => setAccountFor(p)}>
                      <KeyRound size={14} /> Créer un accès
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="cat-foot">
        L'employé se connecte sur la même adresse (app.plomberieinstant.net) avec son courriel/mot de passe.
        Il verra uniquement son propre calendrier de dispatch.
      </p>

      {editing && (
        <PlombierEditor
          plombier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {accountFor && (
        <AccountModal
          plombier={accountFor}
          onClose={() => setAccountFor(null)}
          onCreated={(email) => { setAccountFor(null); setMsg(`Accès créé pour ${accountFor.name} (${email}).`); load(); }}
        />
      )}
    </div>
  );
}

/* Ajouter / modifier un plombier */
function PlombierEditor({ plombier, onClose, onSaved }) {
  const isEdit = !!plombier;
  const [name, setName] = useState(plombier?.name || "");
  const [phone, setPhone] = useState(plombier?.phone || "");
  const [email, setEmail] = useState(plombier?.email || "");
  const [hourly, setHourly] = useState(plombier?.hourly_cost ?? 0);
  const [perf, setPerf] = useState(plombier?.weekly_target ?? 40);
  const [sales, setSales] = useState(plombier?.weekly_sales_target ?? 0);
  const [hiredAt, setHiredAt] = useState(plombier?.hired_at || "");
  const [active, setActive] = useState(plombier?.active !== false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (!name.trim()) { setErr("Le nom est requis."); return; }
    setSaving(true);
    const payload = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      hourly_cost: Number(hourly) || 0,
      weekly_target: Number(perf) || 0,
      weekly_sales_target: Number(sales) || 0,
      hired_at: hiredAt || null,
      active,
    };
    const q = isEdit
      ? supabase.from("pi_plombiers").update(payload).eq("id", plombier.id)
      : supabase.from("pi_plombiers").insert(payload);
    const { error } = await q;
    if (error) { setErr(error.message); setSaving(false); return; }
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <Users size={18} />
          <h2>{isEdit ? "Modifier le plombier" : "Nouveau plombier"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        {err && <div className="msg error" style={{ margin: "1rem 1.25rem 0" }}>{err}</div>}
        <div className="modal-section">
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Nom complet <span className="req-star">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Marc Tremblay" />
          </div>
          <div className="emp-form-row">
            <div className="fld"><label><Phone size={13} /> Téléphone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="450 555-1234" /></div>
            <div className="fld"><label><Mail size={13} /> Courriel</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="plombier@exemple.com" /></div>
          </div>
          <div className="emp-form-row">
            <div className="fld"><label><Target size={13} /> Seuil de performance (h/sem)</label>
              <input type="number" min="0" step="1" value={perf} onChange={(e) => setPerf(e.target.value)} /></div>
            <div className="fld"><label><DollarSign size={13} /> Seuil de vente ($/sem)</label>
              <input type="number" min="0" step="50" value={sales} onChange={(e) => setSales(e.target.value)} /></div>
          </div>
          <div className="emp-form-row">
            <div className="fld"><label>Coût horaire ($)</label>
              <input type="number" min="0" step="0.5" value={hourly} onChange={(e) => setHourly(e.target.value)} /></div>
            <div className="fld"><label><Calendar size={13} /> Date d'embauche</label>
              <input type="date" value={hiredAt} onChange={(e) => setHiredAt(e.target.value)} /></div>
          </div>
          <label className="emp-active-toggle">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Plombier actif</span>
          </label>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={save} disabled={saving}>
            {saving ? (<><Loader2 size={16} className="spin" /> …</>) : (isEdit ? "Enregistrer" : "Créer le plombier")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Créer le compte de connexion d'un plombier */
function AccountModal({ plombier, onClose, onCreated }) {
  const [email, setEmail] = useState(plombier.email || "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const create = async () => {
    setErr("");
    if (!email.trim()) { setErr("Courriel requis."); return; }
    if (password.length < 6) { setErr("Mot de passe : 6 caractères minimum."); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-employee", {
        body: { email: email.trim(), password, plombier_id: plombier.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onCreated(email.trim());
    } catch (e) {
      setErr(`Échec : ${e?.message || e}.`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <UserPlus size={18} />
          <h2>Accès de {plombier.name}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        {err && <div className="msg error" style={{ margin: "1rem 1.25rem 0" }}>{err}</div>}
        <div className="modal-section">
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Courriel de connexion</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="employe@exemple.com" />
          </div>
          <div className="fld">
            <label><KeyRound size={13} /> Mot de passe temporaire</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min. 6 caractères" />
          </div>
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={create} disabled={saving}>
            {saving ? (<><Loader2 size={16} className="spin" /> Création…</>) : (<><Check size={16} /> Créer l'accès</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
