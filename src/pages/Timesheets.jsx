import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import EmployeeDialog from "../components/EmployeeDialog";
import {
  DAYS,
  startOfWeek,
  addDays,
  iso,
  fmtDay,
  isToday,
  hoursBetween,
  fmtHours,
  money,
  weekLabel,
} from "../lib/time";

export default function Timesheets() {
  const [current, setCurrent] = useState(() => new Date());
  const [plombiers, setPlombiers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const weekStart = useMemo(() => startOfWeek(current), [current]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const from = iso(weekStart);
  const to = iso(addDays(weekStart, 6));

  const load = async () => {
    setLoading(true);
    const [pl, pr, pu] = await Promise.all([
      supabase.from("pi_plombiers").select("*").order("created_at"),
      supabase.from("pi_projets").select("*").order("created_at"),
      supabase.from("pi_punches").select("*").gte("jour", from).lte("jour", to),
    ]);
    setPlombiers(pl.data || []);
    setProjects(pr.data || []);
    setPunches(pu.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  // heures[plombierId][isoJour] = somme d'heures
  const grid = useMemo(() => {
    const g = {};
    punches.forEach((p) => {
      g[p.plombier_id] = g[p.plombier_id] || {};
      g[p.plombier_id][p.jour] =
        (g[p.plombier_id][p.jour] || 0) + hoursBetween(p.heure_debut, p.heure_fin);
    });
    return g;
  }, [punches]);

  const rows = useMemo(() => {
    return plombiers.map((pl) => {
      const byDay = grid[pl.id] || {};
      const total = Object.values(byDay).reduce((s, h) => s + h, 0);
      const cost = total * (Number(pl.hourly_cost) || 0);
      const target = Number(pl.weekly_target) || 0;
      const perf = target > 0 ? (total / target) * 100 : 0;
      return { pl, byDay, total, cost, target, perf };
    });
  }, [plombiers, grid]);

  const totals = useMemo(() => {
    const hours = rows.reduce((s, r) => s + r.total, 0);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    return { hours, cost };
  }, [rows]);

  const perfClass = (perf) =>
    perf >= 100 ? "good" : perf >= 75 ? "warn" : "bad";

  return (
    <div className="page timesheets">
      <div className="dispatch-head">
        <div>
          <h1 className="page-title">Feuilles de temps</h1>
          <p className="page-sub">Heures, coûts et performance des plombiers</p>
        </div>
        <div className="week-nav">
          <button onClick={() => setCurrent(addDays(weekStart, -7))} aria-label="Semaine précédente">
            <ChevronLeft size={18} />
          </button>
          <span className="week-label">
            <CalendarDays size={16} /> {weekLabel(weekStart)}
          </span>
          <button onClick={() => setCurrent(addDays(weekStart, 7))} aria-label="Semaine suivante">
            <ChevronRight size={18} />
          </button>
          <button className="btn-today" onClick={() => setCurrent(new Date())}>
            Aujourd'hui
          </button>
        </div>
      </div>

      {loading ? (
        <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Chargement des heures…
        </p>
      ) : (
        <div className="ts-table-wrap">
          <table className="ts-table">
            <thead>
              <tr>
                <th className="ts-name-col">Plombier</th>
                {days.map((d, i) => (
                  <th key={i} className={`ts-day ${isToday(d) ? "today" : ""}`}>
                    <span className="day-name">{DAYS[i]}</span>
                    <span className="day-num">{fmtDay(d)}</span>
                  </th>
                ))}
                <th className="num">Total</th>
                <th className="num">Coût</th>
                <th className="ts-perf-col">Perf.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ pl, byDay, total, cost, target, perf }) => (
                <tr key={pl.id}>
                  <td className="ts-name">
                    <button className="emp-link" onClick={() => setSelected(pl)}>
                      <span className="emp-avatar sm">{pl.name.charAt(0)}</span>
                      {pl.name}
                    </button>
                  </td>
                  {days.map((d, i) => {
                    const h = byDay[iso(d)] || 0;
                    return (
                      <td key={i} className="num ts-cell">
                        {h ? h.toFixed(1).replace(".", ",") : ""}
                      </td>
                    );
                  })}
                  <td className="num ts-total">{fmtHours(total)}</td>
                  <td className="num">{money(cost)}</td>
                  <td className="ts-perf">
                    <span className={`perf-pill ${perfClass(perf)}`}>
                      {perf.toFixed(0)}%
                    </span>
                    <span className="ts-target">/ {target} h</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="cat-empty">Aucun plombier.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="ts-name">Total équipe</td>
                <td colSpan={7}></td>
                <td className="num ts-total">{fmtHours(totals.hours)}</td>
                <td className="num ts-total">{money(totals.cost)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="cat-foot">
        Clique sur un plombier pour ouvrir sa fiche, gérer ses punches, son coût
        horaire et son seuil de performance.
      </p>

      {selected && (
        <EmployeeDialog
          plombier={selected}
          projects={projects}
          weekStart={weekStart}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
