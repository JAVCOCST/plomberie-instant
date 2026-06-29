import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, X,
  GripVertical, Loader2, FolderKanban, Users, MapPin, Navigation,
  Pencil, Camera, Image as ImageIcon, CheckCircle2,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import EmployeeDialog from "../components/EmployeeDialog";
import WeatherStrip from "../components/WeatherStrip";
import {
  DAYS, startOfWeek, addDays, iso, fmtDay, isToday, weekLabel,
} from "../lib/time";

const gpsUrl = (addr) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
const openGps = (addr) => window.open(gpsUrl(addr), "_blank", "noopener");

const PALETTE = [
  "#8a7e72", "#7d8471", "#a0764f", "#6d7b8d", "#8a9a5b",
  "#b08968", "#9c6b4f", "#5f7470", "#a8895c", "#7a6c5d",
];

const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
const dayKey = (rowId, jour) => `${rowId}|${jour}`;

/* Sélecteur de couleur */
function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="cpick">
      <button type="button" className="cpick-dot" style={{ background: value }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-label="Changer la couleur" />
      {open && (
        <>
          <div className="cpick-backdrop" onClick={() => setOpen(false)} />
          <div className="cpick-pop" onClick={(e) => e.stopPropagation()}>
            {PALETTE.map((c) => (
              <button key={c} type="button" className={`cpick-swatch ${c === value ? "sel" : ""}`}
                style={{ background: c }} onClick={() => { onChange(c); setOpen(false); }} aria-label={c} />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/* Pastille déplaçable */
function Chip({ id, data, color, label, initials }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="disp-chip"
      style={{ background: color, opacity: isDragging ? 0.4 : 1 }} title={label}>
      {initials ? <span className="chip-ini">{initials}</span> : <GripVertical size={13} className="chip-grip" />}
      <span className="chip-name">{label}</span>
    </div>
  );
}

/* Case-jour (zone de dépôt) */
function DayCell({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <td ref={setNodeRef} className={`day-cell ${isOver ? "over" : ""}`}>{children}</td>;
}

export default function Dispatch() {
  const [current, setCurrent] = useState(() => new Date());
  const [viewMode, setViewMode] = useState("employees");
  const [plombiers, setPlombiers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [punches, setPunches] = useState([]);
  const [dragged, setDragged] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [projectModal, setProjectModal] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  const reloadPlombiers = async () => {
    const { data } = await supabase.from("pi_plombiers").select("*").order("created_at");
    if (data) setPlombiers(data);
  };
  const reloadProjects = async () => {
    const { data } = await supabase.from("pi_projets").select("*").neq("status", "termine").order("created_at");
    if (data) setProjects(data);
  };
  const updateProjectColor = async (projetId, color) => {
    setProjects((prev) => prev.map((p) => (p.id === projetId ? { ...p, color } : p)));
    await supabase.from("pi_projets").update({ color }).eq("id", projetId);
  };
  const addPlombier = async () => {
    const name = window.prompt("Nom du plombier ?");
    if (!name) return;
    const { data, error: e } = await supabase.from("pi_plombiers").insert({ name: name.trim() }).select().single();
    if (e) return setError("Impossible d'ajouter le plombier.");
    setPlombiers((p) => [...p, data]);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pl, pr, as] = await Promise.all([
        supabase.from("pi_plombiers").select("*").order("created_at"),
        supabase.from("pi_projets").select("*").neq("status", "termine").order("created_at"),
        supabase.from("pi_assignations").select("id,plombier_id,projet_id,jour,heure"),
      ]);
      if (pl.error || pr.error || as.error) { setError("Impossible de charger le dispatch."); setLoading(false); return; }
      setPlombiers(pl.data || []);
      setProjects(pr.data || []);
      setAssignments(as.data || []);
      setLoading(false);
    })();
  }, []);

  const weekStart = useMemo(() => startOfWeek(current), [current]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Punches live (temps réel)
  useEffect(() => {
    const fromIso = iso(weekStart), toIso = iso(addDays(weekStart, 6));
    const loadPunches = async () => {
      const { data } = await supabase.from("pi_punches")
        .select("id,plombier_id,jour,projet_id,heure_debut,heure_fin")
        .gte("jour", fromIso).lte("jour", toIso);
      setPunches(data || []);
    };
    loadPunches();
    const ch = supabase.channel("disp-punches")
      .on("postgres_changes", { event: "*", schema: "public", table: "pi_punches" }, loadPunches).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [weekStart]);

  const plombierById = useMemo(() => Object.fromEntries(plombiers.map((p) => [p.id, p])), [plombiers]);
  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  // état punch par (plombier|jour|projet)
  const punchByKey = useMemo(() => {
    const m = {};
    punches.forEach((p) => { m[`${p.plombier_id}|${p.jour}|${p.projet_id}`] = p; });
    return m;
  }, [punches]);

  // Affectations par case-jour
  const empByDay = useMemo(() => {
    const m = {};
    assignments.forEach((a) => { (m[dayKey(a.plombier_id, a.jour)] = m[dayKey(a.plombier_id, a.jour)] || []).push(a); });
    Object.values(m).forEach((arr) => arr.sort((x, y) => (x.heure || "") < (y.heure || "") ? -1 : 1));
    return m;
  }, [assignments]);
  const projByDay = useMemo(() => {
    const m = {};
    assignments.forEach((a) => { (m[dayKey(a.projet_id, a.jour)] = m[dayKey(a.projet_id, a.jour)] || []).push(a); });
    Object.values(m).forEach((arr) => arr.sort((x, y) => (x.heure || "") < (y.heure || "") ? -1 : 1));
    return m;
  }, [assignments]);

  // Projets non placés cette semaine
  const availableProjects = useMemo(() => {
    const wk = new Set(days.map((d) => iso(d)));
    const placed = new Set();
    assignments.forEach((a) => { if (wk.has(a.jour)) placed.add(a.projet_id); });
    return projects.filter((p) => !placed.has(p.id));
  }, [projects, assignments, days]);

  const addAssignment = async (plombier_id, projet_id, jour, heure = "08:00") => {
    const { data, error: e } = await supabase.from("pi_assignations")
      .insert({ plombier_id, projet_id, jour, heure }).select("id,plombier_id,projet_id,jour,heure").single();
    if (e) { setError("Échec de l'ajout du call."); return; }
    setAssignments((prev) => [...prev, data]);
  };
  const updateAssignmentTime = async (id, heure) => {
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, heure } : a)));
    await supabase.from("pi_assignations").update({ heure }).eq("id", id);
  };
  const removeAssignment = async (id) => {
    setAssignments((prev) => prev.filter((a) => a.id !== id));
    await supabase.from("pi_assignations").delete().eq("id", id);
  };

  const onDragStart = (e) => setDragged(e.active.data.current || null);
  const onDragEnd = (e) => {
    setDragged(null);
    const { active, over } = e;
    if (!over) return;
    const d = active.data.current;
    const [type, rowId, jour] = String(over.id).split("|");
    if (type === "e" && d?.kind === "project") addAssignment(rowId, d.project.id, jour);
    else if (type === "p" && d?.kind === "plombier") addAssignment(d.plombier.id, rowId, jour);
  };

  // Rend une entrée de call (employees view: projet ; projects view: plombier)
  const renderEntry = (a, opts) => {
    const proj = projectById[a.projet_id];
    const pl = plombierById[a.plombier_id];
    if (!proj || !pl) return null;
    const st = punchByKey[`${a.plombier_id}|${a.jour}|${a.projet_id}`];
    const live = st && !st.heure_fin;
    const done = st && st.heure_fin;
    return (
      <div key={a.id} className={`call-entry ${live ? "live" : done ? "done" : ""}`}
        style={{ borderLeftColor: proj.color }}
        onClick={() => setJobDetail({ punch: st, plombier: pl, projet: proj })}>
        <input type="time" className="call-time" value={hhmm(a.heure)} onClick={(e) => e.stopPropagation()}
          onChange={(e) => updateAssignmentTime(a.id, e.target.value)} />
        <span className="call-name">
          {opts === "emp" ? proj.name : pl.name}
        </span>
        {live && <span className="live-dot" title="Sur place" />}
        {proj.address && (
          <button className="gps-btn dark" onClick={(e) => { e.stopPropagation(); openGps(proj.address); }} title={`GPS — ${proj.address}`}>
            <Navigation size={12} />
          </button>
        )}
        <button className="call-rm" onClick={(e) => { e.stopPropagation(); removeAssignment(a.id); }} aria-label="Retirer">
          <X size={12} />
        </button>
      </div>
    );
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="dispatch">
        <div className="dispatch-head">
          <div>
            <h1 className="page-title">Dispatch</h1>
            <p className="page-sub">Glisse-dépose un call sur un jour, puis ajuste l'heure</p>
          </div>
          <div className="disp-controls">
            <div className="view-toggle">
              <button className={viewMode === "projects" ? "active" : ""} onClick={() => setViewMode("projects")}>
                <FolderKanban size={15} /> Projets
              </button>
              <button className={viewMode === "employees" ? "active" : ""} onClick={() => setViewMode("employees")}>
                <Users size={15} /> Employés
              </button>
            </div>
            <div className="week-nav">
              <button onClick={() => setCurrent(addDays(weekStart, -7))} aria-label="Semaine précédente"><ChevronLeft size={18} /></button>
              <span className="week-label"><CalendarDays size={16} /> {weekLabel(weekStart)}</span>
              <button onClick={() => setCurrent(addDays(weekStart, 7))} aria-label="Semaine suivante"><ChevronRight size={18} /></button>
              <button className="btn-today" onClick={() => setCurrent(new Date())}>Aujourd'hui</button>
            </div>
          </div>
        </div>

        <WeatherStrip weekDays={days} />
        {error && <div className="msg error" style={{ marginBottom: "1rem" }}>{error}</div>}

        {loading ? (
          <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 size={16} className="spin" /> Chargement…
          </p>
        ) : (
          <div className="dispatch-stack">
            <div className="dispatch-res">
              <div className="res-row">
                <span className="res-label">Projets</span>
                <div className="res-chips">
                  {availableProjects.length === 0 && <span className="res-empty">Tous les calls sont placés cette semaine.</span>}
                  {availableProjects.map((p) => (
                    <div className="pool-item" key={p.id}>
                      <ColorPicker value={p.color} onChange={(c) => updateProjectColor(p.id, c)} />
                      <Chip id={`proj:${p.id}`} data={{ kind: "project", project: p }} color={p.color} label={p.name} />
                      {Array.isArray(p.photos) && p.photos.length > 0 && (
                        <img src={p.photos[0]} className="proj-thumb" alt="" onClick={() => setProjectModal(p)} />
                      )}
                      <button className="addr-btn set" onClick={() => setProjectModal(p)} title="Modifier le call" aria-label="Modifier">
                        <Pencil size={13} />
                      </button>
                    </div>
                  ))}
                  <button className="mini-add" onClick={() => setProjectModal("new")} aria-label="Ajouter un projet"><Plus size={16} /></button>
                </div>
              </div>
              <div className="res-row">
                <span className="res-label">Plombiers</span>
                <div className="res-chips">
                  {plombiers.map((p) => (
                    <Chip key={p.id} id={`plb:${p.id}`} data={{ kind: "plombier", plombier: p }} color="#6d7b8d" label={p.name} initials={p.name.charAt(0)} />
                  ))}
                  <button className="mini-add" onClick={addPlombier} aria-label="Ajouter un plombier"><Plus size={16} /></button>
                </div>
              </div>
            </div>

            <div className="grid-wrap">
              <table className="cal">
                <thead>
                  <tr>
                    <th className="cal-corner">{viewMode === "employees" ? "Plombier" : "Projet"}</th>
                    {days.map((d, i) => (
                      <th key={i} className={`cal-day ${isToday(d) ? "today" : ""}`}>
                        <span className="cal-day-name">{DAYS[i]}</span>
                        <span className="cal-day-num">{fmtDay(d)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewMode === "employees"
                    ? plombiers.map((pl) => (
                        <tr key={pl.id}>
                          <td className="cal-row-head">
                            <button className="emp-link" onClick={() => setSelected(pl)}>
                              <span className="emp-avatar sm">{pl.name.charAt(0)}</span>{pl.name}
                            </button>
                          </td>
                          {days.map((d) => {
                            const list = empByDay[dayKey(pl.id, iso(d))] || [];
                            return (
                              <DayCell key={iso(d)} id={`e|${pl.id}|${iso(d)}`}>
                                <div className="call-stack">{list.map((a) => renderEntry(a, "emp"))}</div>
                              </DayCell>
                            );
                          })}
                        </tr>
                      ))
                    : projects.map((pr) => (
                        <tr key={pr.id}>
                          <td className="cal-row-head">
                            <ColorPicker value={pr.color} onChange={(c) => updateProjectColor(pr.id, c)} />
                            <span className="row-head-name">{pr.name}</span>
                            <button className="addr-btn set" onClick={() => setProjectModal(pr)} aria-label="Modifier"><Pencil size={13} /></button>
                          </td>
                          {days.map((d) => {
                            const list = projByDay[dayKey(pr.id, iso(d))] || [];
                            return (
                              <DayCell key={iso(d)} id={`p|${pr.id}|${iso(d)}`}>
                                <div className="call-stack">{list.map((a) => renderEntry(a, "proj"))}</div>
                              </DayCell>
                            );
                          })}
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
            <span className="chip-name">{dragged.kind === "project" ? dragged.project.name : dragged.plombier.name}</span>
          </div>
        ) : null}
      </DragOverlay>

      {selected && (
        <EmployeeDialog plombier={selected} projects={projects} weekStart={weekStart}
          onClose={() => setSelected(null)} onChanged={reloadPlombiers} />
      )}
      {jobDetail && (
        <JobDetail punch={jobDetail.punch} plombier={jobDetail.plombier} projet={jobDetail.projet}
          onClose={() => setJobDetail(null)} onFinished={() => { reloadProjects(); setJobDetail(null); }} />
      )}
      {projectModal && (
        <ProjectModal project={projectModal === "new" ? null : projectModal} paletteIndex={projects.length}
          onClose={() => setProjectModal(null)} onSaved={() => { setProjectModal(null); reloadProjects(); }} />
      )}
    </DndContext>
  );
}

/* Détail d'un call : statut + photos temps réel + terminer */
function JobDetail({ punch, plombier, projet, onClose, onFinished }) {
  const [photos, setPhotos] = useState([]);
  const [finishing, setFinishing] = useState(false);

  const finish = async () => {
    setFinishing(true);
    await supabase.from("pi_projets").update({ status: "termine", finished_at: new Date().toISOString() }).eq("id", projet.id);
    onFinished && onFinished();
  };

  useEffect(() => {
    if (!punch?.id) { setPhotos([]); return; }
    const load = async () => {
      const { data } = await supabase.from("pi_punch_photos").select("url,created_at").eq("punch_id", punch.id).order("created_at");
      setPhotos((data || []).map((x) => x.url));
    };
    load();
    const ch = supabase.channel("jobdetail-" + punch.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pi_punch_photos", filter: `punch_id=eq.${punch.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [punch?.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="proj-dot" style={{ background: projet?.color, width: 14, height: 14 }} />
          <h2>{projet?.name}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="modal-section">
          <div className="jd-row">
            <strong>{plombier?.name}</strong>
            <span className={`jd-status ${punch ? (punch.heure_fin ? "done" : "live") : "none"}`}>
              {punch ? (punch.heure_fin ? "Terminé" : "Sur place — en direct") : "Pas encore punché"}
            </span>
          </div>
          {punch && <p className="jd-times">Punch in {hhmm(punch.heure_debut)}{punch.heure_fin ? ` · out ${hhmm(punch.heure_fin)}` : ""}</p>}
          {projet?.address && <button className="emp-gps" onClick={() => openGps(projet.address)}><Navigation size={14} /> {projet.address}</button>}
        </div>
        <div className="modal-section">
          <h3>Photos du chantier {punch && `(${photos.length})`}</h3>
          {!punch ? <p className="page-sub">Le plombier n'a pas encore punché ce call.</p>
            : photos.length === 0 ? <p className="page-sub">Aucune photo pour l'instant — elles s'afficheront ici en direct.</p>
            : <div className="bon-photos">{photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`photo ${i + 1}`} /></a>)}</div>}
        </div>
        {projet && (
          <div className="modal-foot">
            <button className="btn-finish" onClick={finish} disabled={finishing}>
              <CheckCircle2 size={16} /> {finishing ? "…" : "Terminer le call"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Création / édition d'un call */
function ProjectModal({ project, paletteIndex, onClose, onSaved }) {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name || "");
  const [address, setAddress] = useState(project?.address || "");
  const [color, setColor] = useState(project?.color || PALETTE[(paletteIndex || 0) % PALETTE.length]);
  const [existing, setExisting] = useState(Array.isArray(project?.photos) ? project.photos : []);
  const [newFiles, setNewFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (!name.trim()) { setErr("Le nom du call est requis."); return; }
    setSaving(true);
    try {
      let id = project?.id;
      if (!isEdit) {
        const { data, error } = await supabase.from("pi_projets").insert({ name: name.trim(), address: address || null, color }).select().single();
        if (error) throw error;
        id = data.id;
      }
      const urls = [...existing];
      for (let i = 0; i < newFiles.length; i++) {
        const f = newFiles[i];
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `projet/${id}/${Date.now()}_${i}.${ext}`;
        const { error: upErr } = await supabase.storage.from("bons-photos").upload(path, f, { contentType: f.type });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("bons-photos").getPublicUrl(path);
        urls.push(data.publicUrl);
      }
      const { error: uErr } = await supabase.from("pi_projets").update({ name: name.trim(), address: address || null, color, photos: urls }).eq("id", id);
      if (uErr) throw uErr;
      onSaved();
    } catch (e) { setErr(e?.message || "Échec."); setSaving(false); }
  };

  const finish = async () => {
    setErr(""); setSaving(true);
    const { error } = await supabase.from("pi_projets").update({ status: "termine", finished_at: new Date().toISOString() }).eq("id", project.id);
    if (error) { setErr(error.message); setSaving(false); return; }
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="proj-dot" style={{ background: color, width: 14, height: 14 }} />
          <h2>{isEdit ? "Modifier le call" : "Nouveau call"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        {err && <div className="msg error" style={{ margin: "1rem 1.25rem 0" }}>{err}</div>}
        <div className="modal-section">
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Nom du call</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Rénovation salle de bain — Laval" />
          </div>
          <div className="fld" style={{ marginBottom: "0.8rem" }}>
            <label>Adresse (GPS)</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 rue Exemple, Ville" />
          </div>
          <div className="fld">
            <label>Couleur</label>
            <div className="pm-swatches">
              {PALETTE.map((c) => (
                <button key={c} type="button" className={`cpick-swatch ${c === color ? "sel" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-section">
          <h3><Camera size={15} /> Photo de référence <span className="req">(vue par l'employé avant d'arriver)</span></h3>
          <div className="photo-previews">
            {existing.map((url, i) => (
              <div className="photo-prev" key={`e${i}`}>
                <img src={url} alt="" />
                <button className="photo-rm" onClick={() => setExisting((a) => a.filter((_, k) => k !== i))} aria-label="Retirer"><X size={12} /></button>
              </div>
            ))}
            {newFiles.map((f, i) => (
              <div className="photo-prev" key={`n${i}`}>
                <img src={URL.createObjectURL(f)} alt="" />
                <button className="photo-rm" onClick={() => setNewFiles((a) => a.filter((_, k) => k !== i))} aria-label="Retirer"><X size={12} /></button>
              </div>
            ))}
            <label className="emp-add-photo" style={{ height: 76 }}>
              <ImageIcon size={18} /> Ajouter
              <input type="file" accept="image/*" multiple hidden
                onChange={(e) => { setNewFiles((a) => [...a, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
            </label>
          </div>
        </div>
        <div className="modal-foot">
          {isEdit && <button className="btn-finish" onClick={finish} disabled={saving}><CheckCircle2 size={16} /> Terminer le call</button>}
          <span style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={save} disabled={saving}>
            {saving ? (<><Loader2 size={16} className="spin" /> Enregistrement…</>) : (isEdit ? "Enregistrer" : "Créer le call")}
          </button>
        </div>
      </div>
    </div>
  );
}
