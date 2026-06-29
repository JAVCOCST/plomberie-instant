import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, X,
  GripVertical, Loader2, FolderKanban, Users, MapPin, Navigation,
  Pencil, Camera, Trash2, Image as ImageIcon,
} from "lucide-react";

// Lien Google Maps (itinéraire vers l'adresse) — ouvre l'app GPS sur mobile
const gpsUrl = (addr) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
const openGps = (addr) => window.open(gpsUrl(addr), "_blank", "noopener");
import { supabase } from "../supabaseClient";
import EmployeeDialog from "../components/EmployeeDialog";
import WeatherStrip from "../components/WeatherStrip";
import {
  DAYS, PERIODS, startOfWeek, addDays, iso, fmtDay, isToday, weekLabel,
} from "../lib/time";

// Palette « terre » — teintes mates et naturelles
const PALETTE = [
  "#8a7e72", // taupe
  "#7d8471", // sauge
  "#a0764f", // terracotta
  "#6d7b8d", // ardoise
  "#8a9a5b", // olive
  "#b08968", // sable
  "#9c6b4f", // brique
  "#5f7470", // teal mat
  "#a8895c", // ocre
  "#7a6c5d", // champignon
];

const ckey = (rowId, jour, periode) => `${rowId}|${jour}|${periode}`;

/* Sélecteur de couleur (palette terre) en popover */
function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="cpick">
      <button
        type="button"
        className="cpick-dot"
        style={{ background: value }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="Changer la couleur"
      />
      {open && (
        <>
          <div className="cpick-backdrop" onClick={() => setOpen(false)} />
          <div className="cpick-pop" onClick={(e) => e.stopPropagation()}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`cpick-swatch ${c === value ? "sel" : ""}`}
                style={{ background: c }}
                onClick={() => { onChange(c); setOpen(false); }}
                aria-label={c}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

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
  const [punches, setPunches] = useState([]); // punches de la semaine (live)
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

  const updateProjectColor = async (projetId, color) => {
    setProjects((prev) => prev.map((p) => (p.id === projetId ? { ...p, color } : p)));
    await supabase.from("pi_projets").update({ color }).eq("id", projetId);
  };

  const [projectModal, setProjectModal] = useState(null); // null | "new" | project

  const reloadProjects = async () => {
    const { data } = await supabase.from("pi_projets").select("*").order("created_at");
    if (data) setProjects(data);
  };

  const addPlombier = async () => {
    const name = window.prompt("Nom du plombier ?");
    if (!name) return;
    const { data, error: e } = await supabase
      .from("pi_plombiers").insert({ name: name.trim() }).select().single();
    if (e) return setError("Impossible d'ajouter le plombier.");
    setPlombiers((p) => [...p, data]);
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

  // Punches de la semaine + temps réel (indicateur « live » dans le calendrier)
  useEffect(() => {
    const fromIso = iso(weekStart);
    const toIso = iso(addDays(weekStart, 6));
    const loadPunches = async () => {
      const { data } = await supabase
        .from("pi_punches")
        .select("id,plombier_id,jour,periode,heure_debut,heure_fin")
        .gte("jour", fromIso)
        .lte("jour", toIso);
      setPunches(data || []);
    };
    loadPunches();
    const ch = supabase
      .channel("disp-punches")
      .on("postgres_changes", { event: "*", schema: "public", table: "pi_punches" }, loadPunches)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [weekStart]);

  // État de punch par case : plombier|jour|periode -> 'live' | 'done'
  const punchState = useMemo(() => {
    const m = {};
    punches.forEach((p) => {
      m[`${p.plombier_id}|${p.jour}|${p.periode}`] = p.heure_fin ? "done" : "live";
    });
    return m;
  }, [punches]);

  // Map case -> punch complet (pour ouvrir le détail)
  const cellPunch = useMemo(() => {
    const m = {};
    punches.forEach((p) => { m[`${p.plombier_id}|${p.jour}|${p.periode}`] = p; });
    return m;
  }, [punches]);

  const [jobDetail, setJobDetail] = useState(null); // { punch, plombier, projet }
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
          <div className="dispatch-stack">
            {/* Réserves au-dessus du calendrier → grille pleine largeur */}
            <div className="dispatch-res">
              <div className="res-row">
                <span className="res-label">Projets</span>
                <div className="res-chips">
                  {projects.map((p) => (
                    <div className="pool-item" key={p.id}>
                      <ColorPicker value={p.color} onChange={(c) => updateProjectColor(p.id, c)} />
                      <Chip id={`proj:${p.id}`} data={{ kind: "project", project: p }} color={p.color} label={p.name} />
                      {Array.isArray(p.photos) && p.photos.length > 0 && (
                        <img src={p.photos[0]} className="proj-thumb" alt="" onClick={() => setProjectModal(p)} />
                      )}
                      <button
                        className={`addr-btn ${(p.address || (p.photos || []).length) ? "set" : ""}`}
                        onClick={() => setProjectModal(p)}
                        title="Modifier le call (adresse, couleur, photo)"
                        aria-label="Modifier"
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  ))}
                  <button className="mini-add" onClick={() => setProjectModal("new")} aria-label="Ajouter un projet">
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div className="res-row">
                <span className="res-label">Plombiers</span>
                <div className="res-chips">
                  {plombiers.map((p) => (
                    <Chip key={p.id} id={`plb:${p.id}`} data={{ kind: "plombier", plombier: p }} color="#6d7b8d" label={p.name} initials={p.name.charAt(0)} />
                  ))}
                  <button className="mini-add" onClick={addPlombier} aria-label="Ajouter un plombier">
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>

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
                            const st = punchState[key];
                            return (
                              <Cell key={key} id={`e|${pl.id}|${iso(d)}|${per}`}>
                                {proj && (
                                  <div
                                    className={`cell-assign clickable ${st || ""}`}
                                    style={{ background: proj.color }}
                                    title={st === "live" ? `${proj.name} — sur place (punché)` : proj.name}
                                    onClick={() => setJobDetail({ punch: cellPunch[key], plombier: pl, projet: proj })}
                                  >
                                    {st === "live" && <span className="live-dot" title="Sur place — punché in" />}
                                    {st === "done" && <span className="done-dot" title="Terminé" />}
                                    <span className="cell-assign-name">{proj.name}</span>
                                    {proj.address && (
                                      <button className="gps-btn" onClick={(e) => { e.stopPropagation(); openGps(proj.address); }} title={`GPS — ${proj.address}`} aria-label="Ouvrir le GPS">
                                        <Navigation size={11} />
                                      </button>
                                    )}
                                    <button className="cell-remove" onClick={(e) => { e.stopPropagation(); removeByPlombierCell(pl.id, iso(d), per); }} aria-label="Retirer">
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
                            <ColorPicker value={pr.color} onChange={(c) => updateProjectColor(pr.id, c)} />
                            <span className="row-head-name">{pr.name}</span>
                            <button
                              className={`addr-btn ${pr.address ? "set" : ""}`}
                              onClick={() => (pr.address ? openGps(pr.address) : setProjectModal(pr))}
                              title={pr.address ? `Ouvrir le GPS — ${pr.address}` : "Définir l'adresse"}
                              aria-label="GPS"
                            >
                              {pr.address ? <Navigation size={14} /> : <MapPin size={14} />}
                            </button>
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
                                    const st = punchState[`${pid}|${iso(d)}|${per}`];
                                    return (
                                      <div key={pid} className={`cell-emp ${st || ""}`} onClick={() => setSelected(pl)} title={st === "live" ? `${pl.name} — sur place` : pl.name}>
                                        <span className="emp-avatar xs">{pl.name.charAt(0)}</span>
                                        <span className="cell-emp-name">{pl.name}</span>
                                        {st === "live" && <span className="live-dot" />}
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

      {jobDetail && (
        <JobDetail
          punch={jobDetail.punch}
          plombier={jobDetail.plombier}
          projet={jobDetail.projet}
          onClose={() => setJobDetail(null)}
        />
      )}

      {projectModal && (
        <ProjectModal
          project={projectModal === "new" ? null : projectModal}
          paletteIndex={projects.length}
          onClose={() => setProjectModal(null)}
          onSaved={() => { setProjectModal(null); reloadProjects(); }}
        />
      )}
    </DndContext>
  );
}

/* Création / édition d'un call : nom, adresse, couleur, photo de référence */
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
        const { data, error } = await supabase
          .from("pi_projets").insert({ name: name.trim(), address: address || null, color }).select().single();
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
      const { error: uErr } = await supabase
        .from("pi_projets").update({ name: name.trim(), address: address || null, color, photos: urls }).eq("id", id);
      if (uErr) throw uErr;
      onSaved();
    } catch (e) {
      setErr(e?.message || "Échec de l'enregistrement.");
      setSaving(false);
    }
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
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Annuler</button>
          <button className="save-btn" onClick={save} disabled={saving}>
            {saving ? (<><Loader2 size={16} className="spin" /> Enregistrement…</>) : (isEdit ? "Enregistrer" : "Créer le call")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Détail d'un call : statut du punch + photos en temps réel */
function JobDetail({ punch, plombier, projet, onClose }) {
  const [photos, setPhotos] = useState([]);

  useEffect(() => {
    if (!punch?.id) return;
    const load = async () => {
      const { data } = await supabase
        .from("pi_punch_photos")
        .select("url,created_at")
        .eq("punch_id", punch.id)
        .order("created_at");
      setPhotos((data || []).map((x) => x.url));
    };
    load();
    const ch = supabase
      .channel("jobdetail-" + punch.id)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pi_punch_photos", filter: `punch_id=eq.${punch.id}` },
        load
      )
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
          {punch && (
            <p className="jd-times">
              Punch in {punch.heure_debut?.slice(0, 5)}
              {punch.heure_fin ? ` · out ${punch.heure_fin.slice(0, 5)}` : ""}
            </p>
          )}
          {projet?.address && (
            <button className="emp-gps" onClick={() => openGps(projet.address)}>
              <Navigation size={14} /> {projet.address}
            </button>
          )}
        </div>

        <div className="modal-section">
          <h3>Photos du chantier {punch && `(${photos.length})`}</h3>
          {!punch ? (
            <p className="page-sub">Le plombier n'a pas encore punché ce call.</p>
          ) : photos.length === 0 ? (
            <p className="page-sub">Aucune photo pour l'instant — elles s'afficheront ici en direct dès que le plombier en ajoute.</p>
          ) : (
            <div className="bon-photos">
              {photos.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`photo ${i + 1}`} /></a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
