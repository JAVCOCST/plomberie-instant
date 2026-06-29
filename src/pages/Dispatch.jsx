import { useMemo, useState } from "react";
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
} from "lucide-react";

/* ---------- Persistance locale ---------- */
const LS = {
  plombiers: "pi_dispatch_plombiers_v1",
  projects: "pi_dispatch_projects_v1",
  assign: "pi_dispatch_assign_v1",
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return fallback;
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

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
  return new Date(d).toISOString().slice(0, 10);
}
function fmtDay(d) {
  return new Date(d).getDate();
}
function isToday(d) {
  return iso(d) === iso(new Date());
}

const PALETTE = [
  "#2563eb",
  "#16a34a",
  "#db2777",
  "#ea580c",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#dc2626",
];

const SEED_PLOMBIERS = [
  { id: "p1", name: "Marc Tremblay" },
  { id: "p2", name: "Éric Gagnon" },
  { id: "p3", name: "Sophie Roy" },
];
const SEED_PROJECTS = [
  { id: "j1", name: "Rénovation salle de bain — Laval", color: PALETTE[0] },
  { id: "j2", name: "Chauffe-eau — Longueuil", color: PALETTE[1] },
  { id: "j3", name: "Urgence dégât d'eau — Brossard", color: PALETTE[3] },
];

const cellKey = (plombierId, dateIso, period) =>
  `${plombierId}|${dateIso}|${period}`;

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
        <div
          className="cell-assign"
          style={{ background: project.color }}
          title={project.name}
        >
          <span className="cell-assign-name">{project.name}</span>
          <button
            className="cell-remove"
            onClick={onRemove}
            aria-label="Retirer"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
    </td>
  );
}

export default function Dispatch() {
  const [current, setCurrent] = useState(() => new Date());
  const [plombiers, setPlombiers] = useState(() =>
    load(LS.plombiers, SEED_PLOMBIERS)
  );
  const [projects, setProjects] = useState(() =>
    load(LS.projects, SEED_PROJECTS)
  );
  const [assign, setAssign] = useState(() => load(LS.assign, {}));
  const [dragged, setDragged] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } })
  );

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

  const persistAssign = (next) => {
    setAssign(next);
    save(LS.assign, next);
  };

  const onDragStart = (e) => {
    setDragged(e.active.data.current?.project || null);
  };

  const onDragEnd = (e) => {
    setDragged(null);
    const { active, over } = e;
    if (!over) return;
    const project = active.data.current?.project;
    const from = active.data.current?.from;
    if (!project) return;
    const target = String(over.id);
    const next = { ...assign };
    if (from && from !== target) delete next[from]; // déplacement entre cases
    next[target] = project.id;
    persistAssign(next);
  };

  const removeAssign = (key) => {
    const next = { ...assign };
    delete next[key];
    persistAssign(next);
  };

  const addPlombier = () => {
    const name = window.prompt("Nom du plombier ?");
    if (!name) return;
    const next = [...plombiers, { id: `p${Date.now()}`, name: name.trim() }];
    setPlombiers(next);
    save(LS.plombiers, next);
  };

  const addProject = () => {
    const name = window.prompt("Nom du projet / soumission ?");
    if (!name) return;
    const color = PALETTE[projects.length % PALETTE.length];
    const next = [...projects, { id: `j${Date.now()}`, name: name.trim(), color }];
    setProjects(next);
    save(LS.projects, next);
  };

  const weekLabel = `${fmtDay(weekStart)} – ${fmtDay(addDays(weekStart, 6))} ${weekStart.toLocaleDateString(
    "fr-CA",
    { month: "long", year: "numeric" }
  )}`;

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

        <div className="dispatch-body">
          {/* Panneau projets à assigner */}
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

          {/* Grille planning */}
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
                      <th key={`${i}-${per}`} className="period-th">
                        {per}
                      </th>
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
                          <Cell
                            key={key}
                            id={key}
                            project={project}
                            onRemove={() => removeAssign(key)}
                          />
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
