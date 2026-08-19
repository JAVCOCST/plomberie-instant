import { useEffect, useMemo, useState } from "react";
import {
  UserPlus, Loader2, Check, KeyRound, X, Users, Pencil, Phone, Mail,
  Target, DollarSign, Calendar, ShieldCheck, ShieldAlert, Plus, TrendingUp,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { money, fmtHours, hoursBetween, startOfWeek, addDays, iso } from "../lib/time";

const perfClass = (p) => (p >= 100 ? "good" : p >= 75 ? "warn" : "bad");

export default function AccesEmployes() {
  const [plombiers, setPlombiers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [punches, setPunches] = useState([]);
  const [bons, setBons] = useState([]);
  const [compPrice, setCompPrice] = useState(null); // taux horaire du produit « Compagnon »
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // "new" | plombier
  const [accountFor, setAccountFor] = useState(null); // plombier
  const [msg, setMsg] = useState("");

  // Bornes de dates : semaine, mois, année (jusqu'à aujourd'hui)
  const bounds = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const ws = startOfWeek(now);
    return {
      weekStart: iso(ws),
      weekEnd: iso(addDays(ws, 6)),
      monthStart: iso(new Date(y, m, 1)),
      monthEnd: iso(new Date(y, m + 1, 0)),
      yearStart: iso(new Date(y, 0, 1)),
      today: iso(now),
    };
  }, []);
  const yearFrom = bounds.yearStart;

  const load = async () => {
    setLoading(true);
    const [pl, pr, pu, bo, cp] = await Promise.all([
      supabase.from("pi_plombiers").select("*").order("name"),
      supabase.from("pi_profiles").select("plombier_id,role"),
      supabase.from("pi_punches").select("plombier_id,heure_debut,heure_fin,jour").gte("jour", yearFrom).lte("jour", bounds.today),
      supabase.from("pi_bons_travail").select("plombier_id,total,items,jour").gte("jour", yearFrom).lte("jour", bounds.today),
      supabase.from("pi_produits").select("unit_price").ilike("name", "%compagnon%").limit(1),
    ]);
    setPlombiers(pl.data || []);
    setProfiles(pr.data || []);
    setPunches(pu.data || []);
    setBons(bo.data || []);
    setCompPrice(cp.data?.[0]?.unit_price != null ? Number(cp.data[0].unit_price) : null);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [yearFrom]);

  const linkedIds = useMemo(
    () => new Set(profiles.filter((p) => p.role === "employee" && p.plombier_id).map((p) => p.plombier_id)),
    [profiles]
  );

  // Statistiques par plombier et par période (semaine / mois / année) :
  //  h = heures réelles (punches) · s = ventes · b = heures facturées (produit « Compagnon »)
  const stats = useMemo(() => {
    const mk = () => ({ h: {}, s: {}, b: {} });
    const out = { week: mk(), month: mk(), year: mk() };
    const isCompagnon = (it) => {
      if (String(it.desc || "").trim().toLowerCase().includes("compagnon")) return true;
      if (compPrice != null && Math.abs((Number(it.price) || 0) - compPrice) < 0.01) return true;
      return false;
    };
    const periodsFor = (jour) => {
      const p = ["year"];
      if (jour >= bounds.monthStart && jour <= bounds.monthEnd) p.push("month");
      if (jour >= bounds.weekStart && jour <= bounds.weekEnd) p.push("week");
      return p;
    };
    punches.forEach((p) => {
      if (!p.heure_fin) return;
      const hrs = hoursBetween(p.heure_debut, p.heure_fin);
      periodsFor(p.jour).forEach((k) => { out[k].h[p.plombier_id] = (out[k].h[p.plombier_id] || 0) + hrs; });
    });
    bons.forEach((bon) => {
      const sale = Number(bon.total) || 0;
      const items = Array.isArray(bon.items) ? bon.items : [];
      let comp = 0;
      items.forEach((it) => { if (isCompagnon(it)) comp += Number(it.qty) || 0; });
      periodsFor(bon.jour).forEach((k) => {
        out[k].s[bon.plombier_id] = (out[k].s[bon.plombier_id] || 0) + sale;
        out[k].b[bon.plombier_id] = (out[k].b[bon.plombier_id] || 0) + comp;
      });
    });
    return out;
  }, [punches, bons, compPrice, bounds]);

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

                {(() => {
                  const tgt = Number(p.weekly_target) || 0;
                  const stg = Number(p.weekly_sales_target) || 0;
                  const rows = [
                    { key: "week", label: "Semaine" },
                    { key: "month", label: "Mois" },
                    { key: "year", label: "Année" },
                  ];
                  const weekPerf = tgt > 0 ? ((stats.week.h[p.id] || 0) / tgt) * 100 : null;
                  const weekSalesPct = stg > 0 ? ((stats.week.s[p.id] || 0) / stg) * 100 : null;
                  return (
                    <div className="emp-card-perf">
                      <div className="emp-perf-title"><TrendingUp size={12} /> Performance & ventes</div>
                      <table className="emp-perf-table">
                        <thead>
                          <tr><th></th><th>Réelles</th><th>Facturées</th><th>Ventes</th></tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.key}>
                              <td className="epk">{r.label}</td>
                              <td>{fmtHours(stats[r.key].h[p.id] || 0)}</td>
                              <td>{fmtHours(stats[r.key].b[p.id] || 0)}</td>
                              <td className="eps">{money(stats[r.key].s[p.id] || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(weekPerf != null || weekSalesPct != null) && (
                        <div className="emp-perf-goals">
                          <span>Objectif semaine :</span>
                          {weekPerf != null && <span className={`perf-pill ${perfClass(weekPerf)}`}>{weekPerf.toFixed(0)}% h</span>}
                          {weekSalesPct != null && <span className={`perf-pill ${perfClass(weekSalesPct)}`}>{weekSalesPct.toFixed(0)}% ventes</span>}
                        </div>
                      )}
                    </div>
                  );
                })()}

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
