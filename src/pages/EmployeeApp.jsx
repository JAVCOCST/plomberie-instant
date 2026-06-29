import { useEffect, useMemo, useState } from "react";
import {
  LogOut, Navigation, LogIn, ClipboardCheck, CheckCircle2,
  ChevronLeft, ChevronRight, CalendarDays, Loader2, Clock,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { BonForm } from "./BonsTravail";
import {
  DAYS, startOfWeek, addDays, iso, fmtDay, isToday, weekLabel, hoursBetween, fmtHours,
} from "../lib/time";

function nowHHMM() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
const openGps = (a) =>
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`, "_blank", "noopener");

export default function EmployeeApp({ plombierId }) {
  const [current, setCurrent] = useState(() => new Date());
  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [punches, setPunches] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bonFor, setBonFor] = useState(null); // { projet_id, punchId }

  const weekStart = useMemo(() => startOfWeek(current), [current]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const from = iso(weekStart);
  const to = iso(addDays(weekStart, 6));

  const load = async () => {
    setLoading(true);
    const [pl, pr, as, pu, cl] = await Promise.all([
      supabase.from("pi_plombiers").select("*").eq("id", plombierId).maybeSingle(),
      supabase.from("pi_projets").select("*"),
      supabase.from("pi_assignations").select("*").eq("plombier_id", plombierId).gte("jour", from).lte("jour", to),
      supabase.from("pi_punches").select("*").eq("plombier_id", plombierId).gte("jour", from).lte("jour", to),
      supabase.from("pi_clients").select("qbo_id,display_name,email,address").order("display_name"),
    ]);
    setMe(pl.data);
    setProjects(pr.data || []);
    setAssignments(as.data || []);
    setPunches(pu.data || []);
    setClients(cl.data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (plombierId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plombierId, from]);

  const projById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const punchFor = (jour, periode, projet_id) =>
    punches.find((p) => p.jour === jour && p.periode === periode && p.projet_id === projet_id);

  const punchIn = async (a) => {
    await supabase.from("pi_punches").insert({
      plombier_id: plombierId, jour: a.jour, periode: a.periode,
      projet_id: a.projet_id, heure_debut: nowHHMM(),
    });
    load();
  };
  const finishBon = async (punchId) => {
    await supabase.from("pi_punches").update({ heure_fin: nowHHMM() }).eq("id", punchId);
    setBonFor(null);
    load();
  };

  // Affectations groupées par jour (uniquement les jours qui en ont)
  const byDay = useMemo(() => {
    const m = {};
    assignments.forEach((a) => { (m[a.jour] = m[a.jour] || []).push(a); });
    return m;
  }, [assignments]);

  return (
    <div className="emp-app">
      <header className="emp-header">
        <img src="/favicon.png" alt="Plomberie Instant" className="emp-logo" />
        <div className="emp-id">
          <strong>{me?.name || "Mon dispatch"}</strong>
          <span>Plomberie Instant</span>
        </div>
        <button className="emp-logout" onClick={() => supabase.auth.signOut()} aria-label="Déconnexion">
          <LogOut size={18} />
        </button>
      </header>

      <div className="emp-weeknav">
        <button onClick={() => setCurrent(addDays(weekStart, -7))} aria-label="Semaine précédente"><ChevronLeft size={18} /></button>
        <span><CalendarDays size={15} /> {weekLabel(weekStart)}</span>
        <button onClick={() => setCurrent(addDays(weekStart, 7))} aria-label="Semaine suivante"><ChevronRight size={18} /></button>
      </div>

      <div className="emp-body">
        {loading ? (
          <p className="emp-loading"><Loader2 size={18} className="spin" /> Chargement…</p>
        ) : assignments.length === 0 ? (
          <div className="emp-empty">Aucun chantier cette semaine.</div>
        ) : (
          days.map((d, i) => {
            const list = byDay[iso(d)] || [];
            if (list.length === 0) return null;
            return (
              <div key={i} className={`emp-day ${isToday(d) ? "today" : ""}`}>
                <div className="emp-day-head">
                  {DAYS[i]} {fmtDay(d)} {isToday(d) && <span className="emp-today-tag">Aujourd'hui</span>}
                </div>
                {list
                  .sort((a, b) => (a.periode > b.periode ? 1 : -1))
                  .map((a) => {
                    const proj = projById[a.projet_id];
                    const punch = punchFor(a.jour, a.periode, a.projet_id);
                    const done = punch && punch.heure_fin;
                    const open = punch && !punch.heure_fin;
                    return (
                      <div key={a.id} className="emp-job" style={{ borderLeftColor: proj?.color || "#94a3b8" }}>
                        <div className="emp-job-top">
                          <span className="emp-job-name">{proj?.name || "Projet"}</span>
                          <span className="emp-job-per">{a.periode}</span>
                        </div>
                        {proj?.address && (
                          <button className="emp-gps" onClick={() => openGps(proj.address)}>
                            <Navigation size={14} /> {proj.address}
                          </button>
                        )}
                        <div className="emp-job-action">
                          {done ? (
                            <span className="emp-done">
                              <CheckCircle2 size={16} /> Terminé · {punch.heure_debut?.slice(0,5)}–{punch.heure_fin?.slice(0,5)} ({fmtHours(hoursBetween(punch.heure_debut, punch.heure_fin))})
                            </span>
                          ) : open ? (
                            <button className="emp-btn out" onClick={() => setBonFor({ projet_id: a.projet_id, punchId: punch.id })}>
                              <ClipboardCheck size={16} /> Punch out — remplir le bon
                            </button>
                          ) : (
                            <button className="emp-btn in" onClick={() => punchIn(a)}>
                              <LogIn size={16} /> Punch in
                            </button>
                          )}
                        </div>
                        {open && (
                          <p className="emp-hint"><Clock size={12} /> Punché à {punch.heure_debut?.slice(0,5)} — remplis le bon de travail pour puncher out.</p>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {bonFor && (
        <BonForm
          plombiers={me ? [me] : []}
          projects={projects}
          clients={clients}
          fixedPlombierId={plombierId}
          fixedProjetId={bonFor.projet_id}
          onClose={() => setBonFor(null)}
          onSaved={() => finishBon(bonFor.punchId)}
        />
      )}
    </div>
  );
}
