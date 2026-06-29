import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Plus,
  X,
  GripVertical,
  Loader2,
} from "lucide-react";
import { supabase } from "../supabaseClient";

/* ---------- Dates (semaine lundi → dimanche) ---------- */
const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const PERIODS = ["AM", "PM"];

function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // lundi = 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}
function addDays(d, n) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}
function iso(d) {
  const date = new Date(d);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${day}`;
}
function fmtDay(d) {
  return new Date(d).getDate();
}
function isToday(d) {
  return iso(d) === iso(new Date());
}

const PALETTE = [
  "#2563eb", "#16a34a", "#db2777", "#ea580c",
  "#7c3aed", "#0891b2", "#ca8a04", "#dc2626",
];

const cellKey = (plombierId, dateIso, period) =>
  `${plombierId}|${dateIso}|${period}`;
function parseCell(key) {
  const [plombier_id, jour, periode] = key.split("|");
  return { plombier_id, jour, periode };
}

/* ---------- Chip de projet (déplaçable) ---------- */
function ProjectChip({ project, from }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: from ? `cell:${from}` : `proj:${project.id}`,
    data: { project, from },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="proj-chip"
      style={{ background: project.color, opacity: isDragging ? 0.4 : 1 }}
      title={project.name}
    >
      <GripVertical size={13} className="chip-grip" />
      <span className="chip-name">{project.name}</span>
    </div>
  );
}

/* ---------- Case du planning (zone de dépôt) ---------- */
function Cell({ id, project, onRemove }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <td ref={setNodeRef} className={`grid-cell ${isOver ? "over" : ""}`}>
      {project ? (
        <div className="cell-assign" style={{ background: project.color }} title={project.name}>
          <span className="cell-assign-name">{project.name}</span>
          <button className="cell-remove" onClick={onRemove} aria-label="Retirer">
            <X size={12} />
          </button>
        </div>
      ) : null}
    </td>
  );
}

export default function Dispatch() {
  const [current, setCurrent] = useState(() => new Date());
  const [plombiers, setPlombiers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [assign, setAssign] = useState({}); // cellKey -> projet_id
  const [dragged, setDragged] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } })
  );

  // Chargement initial depuis Supabase
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pl, pr, as] = await Promise.all([
        supabase.from("pi_plombiers").select("*").order("created_at"),
        supabase.from("pi_projets").select("*").order("created_at"),
        supabase.from("pi_assignations").select("*"),
      ]);
      if (pl.error || pr.error || as.error) {
        setError("Impossible de charger les données du dispatch.");
        setLoading(false);
        return;
      }
      setPlombiers(pl.data || []);
      setProjects(pr.data || []);
      const map = {};
      (as.data || []).forEach((a) => {
        map[cellKey(a.plombier_id, a.jour, a.periode)] = a.projet_id;
      });
      setAssign(map);
      setLoading(false);
    })();
  }, []);

  const weekStart = useMemo(() => startOfWeek(current), [current]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const projectById = useMemo(() => {
    const m = {};
    projects.forEach((p) => (m[p.id] = p));
    return m;
  }, [projects]);

  const onDragStart = (e) => setDragged(e.active.data.current?.project || null);

  const onDragEnd = async (e) => {
    setDragged(null);
    const { active, over } = e;
    if (!over) return;
    const project = active.data.current?.project;
    const from = active.data.current?.from;
    if (!project) return;
    const target = String(over.id);
    if (from === target) return;

    // Optimiste
    const next = { ...assign };
    if (from && from !== target) delete next[from];
    next[target] = project.id;
    setAssign(next);

    const t = parseCell(target);
    const { error: upErr } = await supabase
      .from("pi_assignations")
      .upsert(
        { plombier_id: t.plombier_id, projet_id: project.id, jour: t.jour, periode: t.periode },
        { onConflict: "plombier_id,jour,periode" }
      );
    if (from && from !== target) {
      const f = parseCell(from);
      await supabase.from("pi_assignations").delete().match({
        plombier_id: f.plombier_id, jour: f.jour, periode: f.periode,
      });
    }
    if (upErr) setError("Échec de l'enregistrement de l'assignation.");
  };

  const removeAssign = async (key) => {
    const next = { ...assign };
    delete next[key];
    setAssign(next);
    const c = parseCell(key);
    await supabase.from("pi_assignations").delete().match({
      plombier_id: c.plombier_id, jour: c.jour, periode: c.periode,
    });
  };

  const addPlombier = async () => {
    const name = window.prompt("Nom du plombier ?");
    if (!name) return;
    const { data, error: e } = await supabase
      .from("pi_plombiers").insert({ name: name.trim() }).select().single();
    if (e) return setError("Impossible d'ajouter le plombier.");
    setPlombiers((p) => [...p, data]);
  };

  const addProject = async () => {
    const name = window.prompt("Nom du projet / soumission ?");
    if (!name) return;
    const color = PALETTE[projects.length % PALETTE.length];
    const { data, error: e } = await supabase
      .from("pi_projets").insert({ name: name.trim(), color }).select().single();
    if (e) return setError("Impossible d'ajouter le projet.");
    setProjects((p) => [...p, data]);
  };

  const weekLabel = `${fmtDay(weekStart)} – ${fmtDay(addDays(weekStart, 6))} ${weekStart.toLocaleDateString(
    "fr-CA",
    { month: "long", year: "numeric" }
  )}`;

  if (loading) {
    return (
      <div className="dispatch">
        <h1 className="page-title">Dispatch</h1>
        <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Chargement du planning…
        </p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="dispatch">
        <div className="dispatch-head">
          <div>
            <h1 className="page-title">Dispatch</h1>
            <p className="page-sub">Planification hebdomadaire des plombiers</p>
          </div>
          <div className="week-nav">
            <button onClick={() => setCurrent(addDays(weekStart, -7))} aria-label="Semaine précédente">
              <ChevronLeft size={18} />
            </button>
            <span className="week-label">
              <CalendarDays size={16} /> {weekLabel}
            </span>
            <button onClick={() => setCurrent(addDays(weekStart, 7))} aria-label="Semaine suivante">
              <ChevronRight size={18} />
            </button>
            <button className="btn-today" onClick={() => setCurrent(new Date())}>
              Aujourd'hui
            </button>
          </div>
        </div>

        {error && <div className="msg error" style={{ marginBottom: "1rem" }}>{error}</div>}

        <div className="dispatch-body">
          <aside className="proj-pool">
            <div className="pool-head">
              <span>Projets</span>
              <button className="mini-add" onClick={addProject} aria-label="Ajouter un projet">
                <Plus size={16} />
              </button>
            </div>
            <div className="pool-list">
              {projects.map((p) => (
                <ProjectChip key={p.id} project={p} />
              ))}
            </div>
            <p className="pool-hint">Glisse un projet sur une case du planning.</p>
          </aside>

          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th className="corner">
                    <button className="mini-add" onClick={addPlombier} aria-label="Ajouter un plombier">
                      <Plus size={16} /> Plombier
                    </button>
                  </th>
                  {days.map((d, i) => (
                    <th key={i} colSpan={2} className={`day-col ${isToday(d) ? "today" : ""}`}>
                      <span className="day-name">{DAYS[i]}</span>
                      <span className="day-num">{fmtDay(d)}</span>
                    </th>
                  ))}
                </tr>
                <tr className="period-row">
                  <th></th>
                  {days.map((_, i) =>
                    PERIODS.map((per) => (
                      <th key={`${i}-${per}`} className="period-th">{per}</th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {plombiers.map((pl) => (
                  <tr key={pl.id}>
                    <td className="row-head">{pl.name}</td>
                    {days.map((d) =>
                      PERIODS.map((per) => {
                        const key = cellKey(pl.id, iso(d), per);
                        const project = projectById[assign[key]];
                        return (
                          <Cell key={key} id={key} project={project} onRemove={() => removeAssign(key)} />
                        );
                      })
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="proj-chip dragging" style={{ background: dragged.color }}>
            <span className="chip-name">{dragged.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
