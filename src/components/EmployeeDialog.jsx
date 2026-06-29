import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, Phone, Mail, DollarSign, Target, Check, TrendingUp } from "lucide-react";
import { supabase } from "../supabaseClient";
import {
  iso,
  addDays,
  hoursBetween,
  fmtHours,
  money,
  weekLabel,
} from "../lib/time";

export default function EmployeeDialog({ plombier, projects, weekStart, onClose, onChanged }) {
  const [form, setForm] = useState({
    name: plombier.name || "",
    phone: plombier.phone || "",
    email: plombier.email || "",
    hourly_cost: plombier.hourly_cost ?? 0,
    weekly_target: plombier.weekly_target ?? 40,
    weekly_sales_target: plombier.weekly_sales_target ?? 0,
  });
  const [punches, setPunches] = useState([]);
  const [bons, setBons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savedFiche, setSavedFiche] = useState(false);
  const [newPunch, setNewPunch] = useState({
    jour: iso(weekStart),
    heure_debut: "08:00",
    heure_fin: "16:00",
    projet_id: "",
  });

  const from = iso(weekStart);
  const to = iso(addDays(weekStart, 6));

  const loadPunches = async () => {
    const { data } = await supabase
      .from("pi_punches")
      .select("*")
      .eq("plombier_id", plombier.id)
      .gte("jour", from)
      .lte("jour", to)
      .order("jour");
    setPunches(data || []);
    setLoading(false);
  };

  const loadBons = async () => {
    const { data } = await supabase
      .from("pi_bons_travail")
      .select("total")
      .eq("plombier_id", plombier.id)
      .gte("jour", from)
      .lte("jour", to);
    setBons(data || []);
  };

  useEffect(() => {
    loadPunches();
    loadBons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plombier.id, from]);

  const projName = useMemo(() => {
    const m = {};
    projects.forEach((p) => (m[p.id] = p));
    return m;
  }, [projects]);

  const stats = useMemo(() => {
    const hours = punches.reduce(
      (s, p) => s + hoursBetween(p.heure_debut, p.heure_fin),
      0
    );
    const cost = hours * (Number(form.hourly_cost) || 0);
    const target = Number(form.weekly_target) || 0;
    const perf = target > 0 ? (hours / target) * 100 : 0;
    const sales = bons.reduce((s, b) => s + (Number(b.total) || 0), 0);
    const salesTarget = Number(form.weekly_sales_target) || 0;
    const salesPct = salesTarget > 0 ? (sales / salesTarget) * 100 : 0;
    return { hours, cost, target, perf, sales, salesTarget, salesPct };
  }, [punches, bons, form.hourly_cost, form.weekly_target, form.weekly_sales_target]);

  const saveFiche = async () => {
    await supabase
      .from("pi_plombiers")
      .update({
        name: form.name.trim(),
        phone: form.phone || null,
        email: form.email || null,
        hourly_cost: Number(form.hourly_cost) || 0,
        weekly_target: Number(form.weekly_target) || 0,
        weekly_sales_target: Number(form.weekly_sales_target) || 0,
      })
      .eq("id", plombier.id);
    setSavedFiche(true);
    onChanged && onChanged();
  };

  const addPunch = async () => {
    if (!newPunch.heure_debut) return;
    await supabase.from("pi_punches").insert({
      plombier_id: plombier.id,
      jour: newPunch.jour,
      heure_debut: newPunch.heure_debut,
      heure_fin: newPunch.heure_fin || null,
      projet_id: newPunch.projet_id || null,
    });
    await loadPunches();
    onChanged && onChanged();
  };

  const deletePunch = async (id) => {
    await supabase.from("pi_punches").delete().eq("id", id);
    await loadPunches();
    onChanged && onChanged();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="emp-avatar">{form.name.charAt(0) || "?"}</div>
          <h2>{form.name || "Employé"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        {/* Jauges : performance & ventes */}
        <div className="gauges">
          <Gauge
            pct={stats.perf}
            label="Performance"
            value={`${fmtHours(stats.hours)} / ${stats.target} h`}
          />
          <Gauge
            pct={stats.salesPct}
            label="Ventes"
            value={`${money(stats.sales)} / ${money(stats.salesTarget)}`}
          />
        </div>
        <div className="mini-row">
          <span>Coût main-d'œuvre · {weekLabel(weekStart)}</span>
          <strong>{money(stats.cost)}</strong>
        </div>

        {/* Fiche éditable */}
        <div className="modal-section">
          <h3>Fiche</h3>
          <div className="fiche-grid">
            <div className="fld">
              <label>Nom</label>
              <input
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setSavedFiche(false); }}
              />
            </div>
            <div className="fld">
              <label><Phone size={13} /> Téléphone</label>
              <input
                value={form.phone}
                onChange={(e) => { setForm({ ...form, phone: e.target.value }); setSavedFiche(false); }}
                placeholder="514-555-0000"
              />
            </div>
            <div className="fld">
              <label><Mail size={13} /> Courriel</label>
              <input
                value={form.email}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); setSavedFiche(false); }}
                placeholder="nom@plomberieinstant.net"
              />
            </div>
            <div className="fld">
              <label><DollarSign size={13} /> Coût horaire ($/h)</label>
              <input
                type="number" min="0" step="0.5"
                value={form.hourly_cost}
                onChange={(e) => { setForm({ ...form, hourly_cost: e.target.value }); setSavedFiche(false); }}
              />
            </div>
            <div className="fld">
              <label><Target size={13} /> Seuil de performance (h/sem)</label>
              <input
                type="number" min="0" step="1"
                value={form.weekly_target}
                onChange={(e) => { setForm({ ...form, weekly_target: e.target.value }); setSavedFiche(false); }}
              />
            </div>
            <div className="fld">
              <label><TrendingUp size={13} /> Seuil de vente ($/sem)</label>
              <input
                type="number" min="0" step="50"
                value={form.weekly_sales_target}
                onChange={(e) => { setForm({ ...form, weekly_sales_target: e.target.value }); setSavedFiche(false); }}
              />
            </div>
          </div>
          <button className="save-btn small" onClick={saveFiche}>
            {savedFiche ? (<><Check size={15} /> Enregistré</>) : "Enregistrer la fiche"}
          </button>
        </div>

        {/* Punches de la semaine */}
        <div className="modal-section">
          <h3>Punches de la semaine</h3>
          {loading ? (
            <p className="page-sub">Chargement…</p>
          ) : (
            <div className="punch-list">
              {punches.length === 0 && (
                <p className="page-sub">Aucun punch cette semaine.</p>
              )}
              {punches.map((p) => (
                <div className="punch-row" key={p.id}>
                  <span className="punch-day">{p.jour}</span>
                  <span className="punch-time">
                    {p.heure_debut?.slice(0, 5)} → {p.heure_fin ? p.heure_fin.slice(0, 5) : "…"}
                  </span>
                  <span className="punch-h">{fmtHours(hoursBetween(p.heure_debut, p.heure_fin))}</span>
                  <span className="punch-proj">{p.projet_id ? projName[p.projet_id]?.name : ""}</span>
                  <button className="icon-del" onClick={() => deletePunch(p.id)} aria-label="Supprimer">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Ajouter un punch */}
          <div className="punch-add">
            <input
              type="date"
              value={newPunch.jour}
              onChange={(e) => setNewPunch({ ...newPunch, jour: e.target.value })}
            />
            <input
              type="time"
              value={newPunch.heure_debut}
              onChange={(e) => setNewPunch({ ...newPunch, heure_debut: e.target.value })}
            />
            <input
              type="time"
              value={newPunch.heure_fin}
              onChange={(e) => setNewPunch({ ...newPunch, heure_fin: e.target.value })}
            />
            <select
              value={newPunch.projet_id}
              onChange={(e) => setNewPunch({ ...newPunch, projet_id: e.target.value })}
            >
              <option value="">— Projet —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="mini-add" onClick={addPunch}>
              <Plus size={15} /> Punch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Jauge circulaire (SVG) — verte quand l'objectif est atteint */
function Gauge({ pct, label, value }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const capped = Math.max(0, Math.min(pct, 100));
  const offset = c * (1 - capped / 100);
  const cls = pct >= 100 ? "good" : pct >= 75 ? "warn" : "bad";
  return (
    <div className="gauge">
      <svg viewBox="0 0 100 100" className={`gauge-svg ${cls}`}>
        <circle className="gauge-track" cx="50" cy="50" r={r} />
        <circle
          className="gauge-prog"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="52" className="gauge-pct">{Math.round(pct)}%</text>
      </svg>
      <div className="gauge-label">{label}</div>
      <div className="gauge-value">{value}</div>
    </div>
  );
}
