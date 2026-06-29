import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, X,
  GripVertical, Loader2, FolderKanban, Users,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import EmployeeDialog from "../components/EmployeeDialog";
import WeatherStrip from "../components/WeatherStrip";
import {
  DAYS, PERIODS, startOfWeek, addDays, iso, fmtDay, isToday, weekLabel,
} from "../lib/time";

const PALETTE = [
  "#2563eb", "#16a34a", "#db2777", "#ea580c",
  "#7c3aed", "#0891b2", "#ca8a04", "#dc2626",
];

const ckey = (rowId, jour, periode) => `${rowId}|${jour}|${periode}`;

/* Pastille déplaçable (projet ou plombier selon la vue) */
function Chip({ id, data, color, label, initials }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="disp-chip"
      style={{ background: color, opacity: isDragging ? 0.4 : 1 }}
      title={label}
    >
      {initials ? <span className="chip-ini">{initials}</span> : <GripVertical size={13} className="chip-grip" />}
      <span className="chip-name">{label}</span>
    </div>
  );
}

/* Case (zone de dépôt) */
function Cell({ id, children, isOver }) {
  const { setNodeRef, isOver: over } = useDroppable({ id });
  return (
    <td ref={setNodeRef} className={`grid-cell ${over || isOver ? "over" : ""}`}>
      {children}
    </td>
  );
}

export default function Dispatch() {
  const [current, setCurrent] = useState(() => new Date());
  const [viewMode, setViewMode] = useState("employees"); // 'employees' | 'projects'
  const [plombiers, setPlombiers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [assignments, setAssignments] = useState([]); // liste brute
  const [dragged, setDragged] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  const reloadPlombiers = async () => {
    const { data } = await supabase.from("pi_plombiers").select("*").order("created_at");
    if (data) setPlombiers(data);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pl, pr, as] = await Promise.all([
        supabase.from("pi_plombiers").select("*").order("created_at"),
        supabase.from("pi_projets").select("*").order("created_at"),
        supabase.from("pi_assignations").select("*"),
      ]);
      if (pl.error || pr.error || as.error) {
        setError("Impossible de charger le dispatch.");
        setLoading(false);
        return;
      }
      setPlombiers(pl.data || []);
      setProjects(pr.data || []);
      setAssignments(as.data || []);
      setLoading(false);
    })();
  }, []);

  const weekStart = useMemo(() => startOfWeek(current), [current]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const plombierById = useMemo(
    () => Object.fromEntries(plombiers.map((p) => [p.id, p])), [plombiers]
  );
  const projectById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]
  );

  // Map employé : cellKey(plombier) -> projet_id
  const empCell = useMemo(() => {
    const m = {};
    assignments.forEach((a) => { m[ckey(a.plombier_id, a.jour, a.periode)] = a.projet_id; });
    return m;
  }, [assignments]);

  // Map projet : cellKey(projet) -> [plombier_id...]
  const projCell = useMemo(() => {
    const m = {};
    assignments.forEach((a) => {
      const k = ckey(a.projet_id, a.jour, a.periode);
      (m[k] = m[k] || []).push(a.plombier_id);
    });
    return m;
  }, [assignments]);

  const persistUpsert = async (plombier_id, projet_id, jour, periode) => {
    // optimiste
    setAssignments((prev) => {
      const filtered = prev.filter(
        (a) => !(a.plombier_id === plombier_id && a.jour === jour && a.periode === periode)
      );
      return [...filtered, { id: `tmp-${plombier_id}-${jour}-${periode}`, plombier_id, projet_id, jour, periode }];
    });
    const { error: e } = await supabase
      .from("pi_assignations")
      .upsert({ plombier_id, projet_id, jour, periode }, { onConflict: "plombier_id,jour,periode" });
    if (e) setError("Échec de l'enregistrement.");
  };

  const removeByPlombierCell = async (plombier_id, jour, periode) => {
    setAssignments((prev) =>
      prev.filter((a) => !(a.plombier_id === plombier_id && a.jour === jour && a.periode === periode))
    );
    await supabase.from("pi_assignations").delete().match({ plombier_id, jour, periode });
  };

  const onDragStart = (e) => setDragged(e.active.data.current || null);

  const onDragEnd = (e) => {
    setDragged(null);
    const { active, over } = e;
    if (!over) return;
    const d = active.data.current;
    const parts = String(over.id).split("|"); // type|rowId|jour|periode
    if (parts.length !== 4) return;
    const [type, rowId, jour, periode] = parts;
    if (type === "e" && d?.kind === "project") {
      persistUpsert(rowId, d.project.id, jour, periode);
    } else if (type === "p" && d?.kind === "plombier") {
      persistUpsert(d.plombier.id, rowId, jour, periode);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="dispatch">
        <div className="dispatch-head">
          <div>
            <h1 className="page-title">Dispatch</h1>
            <p className="page-sub">Glisse-dépose pour affecter les plombiers aux projets</p>
          </div>
          <div className="disp-controls">
            <div className="view-toggle">
              <button
                className={viewMode === "projects" ? "active" : ""}
                onClick={() => setViewMode("projects")}
              >
                <FolderKanban size={15} /> Projets
              </button>
              <button
                className={viewMode === "employees" ? "active" : ""}
                onClick={() => setViewMode("employees")}
              >
                <Users size={15} /> Employés
              </button>
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
              <button className="btn-today" onClick={() => setCurrent(new Date())}>Aujourd'hui</button>
            </div>
          </div>
        </div>

        <WeatherStrip weekDays={days} />

        {error && <div className="msg error" style={{ marginBottom: "1rem" }}>{error}</div>}

        {loading ? (
          <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 size={16} className="spin" /> Chargement du planning…
          </p>
        ) : (
          <div className="dispatch-body">
            {/* Réserve : projets (vue employés) ou plombiers (vue projets) */}
            <aside className="proj-pool">
              <div className="pool-head">
                <span>{viewMode === "employees" ? "Projets" : "Plombiers"}</span>
              </div>
              <div className="pool-list">
                {viewMode === "employees"
                  ? projects.map((p) => (
                      <Chip key={p.id} id={`proj:${p.id}`} data={{ kind: "project", project: p }} color={p.color} label={p.name} />
                    ))
                  : plombiers.map((p) => (
                      <Chip key={p.id} id={`plb:${p.id}`} data={{ kind: "plombier", plombier: p }} color="#334155" label={p.name} initials={p.name.charAt(0)} />
                    ))}
              </div>
              <p className="pool-hint">
                Glisse {viewMode === "employees" ? "un projet" : "un plombier"} sur une case.
              </p>
            </aside>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="corner">{viewMode === "employees" ? "Plombier" : "Projet"}</th>
                    {days.map((d, i) => (
                      <th key={i} colSpan={2} className={`day-col ${isToday(d) ? "today" : ""}`}>
                        <span className="day-name">{DAYS[i]}</span>
                        <span className="day-num">{fmtDay(d)}</span>
                      </th>
                    ))}
                  </tr>
                  <tr className="period-row">
                    <th></th>
                    {days.map((_, i) => PERIODS.map((per) => (
                      <th key={`${i}-${per}`} className="period-th">{per}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {viewMode === "employees"
                    ? plombiers.map((pl) => (
                        <tr key={pl.id}>
                          <td className="row-head">
                            <button className="emp-link" onClick={() => setSelected(pl)}>
                              <span className="emp-avatar sm">{pl.name.charAt(0)}</span>
                              {pl.name}
                            </button>
                          </td>
                          {days.map((d) => PERIODS.map((per) => {
                            const key = ckey(pl.id, iso(d), per);
                            const proj = projectById[empCell[key]];
                            return (
                              <Cell key={key} id={`e|${pl.id}|${iso(d)}|${per}`}>
                                {proj && (
                                  <div className="cell-assign" style={{ background: proj.color }} title={proj.name}>
                                    <span className="cell-assign-name">{proj.name}</span>
                                    <button className="cell-remove" onClick={() => removeByPlombierCell(pl.id, iso(d), per)} aria-label="Retirer">
                                      <X size={12} />
                                    </button>
                                  </div>
                                )}
                              </Cell>
                            );
                          }))}
                        </tr>
                      ))
                    : projects.map((pr) => (
                        <tr key={pr.id}>
                          <td className="row-head">
                            <span className="proj-dot" style={{ background: pr.color }} />
                            {pr.name}
                          </td>
                          {days.map((d) => PERIODS.map((per) => {
                            const key = ckey(pr.id, iso(d), per);
                            const ids = projCell[key] || [];
                            return (
                              <Cell key={key} id={`p|${pr.id}|${iso(d)}|${per}`}>
                                <div className="cell-stack">
                                  {ids.map((pid) => {
                                    const pl = plombierById[pid];
                                    if (!pl) return null;
                                    return (
                                      <div key={pid} className="cell-emp" onClick={() => setSelected(pl)} title={pl.name}>
                                        <span className="emp-avatar xs">{pl.name.charAt(0)}</span>
                                        <span className="cell-emp-name">{pl.name}</span>
                                        <button className="cell-remove" onClick={(ev) => { ev.stopPropagation(); removeByPlombierCell(pid, iso(d), per); }} aria-label="Retirer">
                                          <X size={11} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </Cell>
                            );
                          }))}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="disp-chip dragging" style={{ background: dragged.kind === "project" ? dragged.project.color : "#334155" }}>
            <span className="chip-name">
              {dragged.kind === "project" ? dragged.project.name : dragged.plombier.name}
            </span>
          </div>
        ) : null}
      </DragOverlay>

      {selected && (
        <EmployeeDialog
          plombier={selected}
          projects={projects}
          weekStart={weekStart}
          onClose={() => setSelected(null)}
          onChanged={reloadPlombiers}
        />
      )}
    </DndContext>
  );
}
