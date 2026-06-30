import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* Glisser-déposer maison qui SURVIT au changement de page.
   (dnd-kit/HTML5 annulent le drag quand la page source est démontée ;
   ici on pilote tout avec les pointer events au niveau de l'app.) */
const Ctx = createContext(null);
export const useProjectDrag = () => useContext(Ctx) || {};

export function ProjectDragProvider({ children }) {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState("");
  const [hoverGroup, setHoverGroup] = useState(null);
  const ghostRef = useRef(null);
  const pending = useRef(null);
  const dropRef = useRef(null);
  const lastSlot = useRef(null);

  const registerDrop = useCallback((fn) => { dropRef.current = fn; }, []);

  const clearSlot = () => {
    if (lastSlot.current) { lastSlot.current.classList.remove("ext-drop-over"); lastSlot.current = null; }
  };

  const onMove = useCallback((e) => {
    const p = pending.current;
    if (!p) return;
    if (!p.active) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < 6) return;
      p.active = true;
      setActive(true);
      setLabel(p.project.name);
      document.body.classList.add("proj-dragging");
    }
    if (ghostRef.current) {
      ghostRef.current.style.left = `${e.clientX + 12}px`;
      ghostRef.current.style.top = `${e.clientY + 10}px`;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);

    // Survol d'un en-tête de groupe → l'ouvrir (ex. Opérations)
    const grp = el?.closest?.("[data-nav-group]")?.getAttribute("data-nav-group") || null;
    setHoverGroup((cur) => (cur === grp ? cur : grp));

    // Survol de l'item Dispatch → ouvrir la page Dispatch
    const navItem = el?.closest?.("[data-nav-item]")?.getAttribute("data-nav-item");
    if (navItem === "/app/dispatch" && !p.navigated) {
      p.navigated = true;
      navigate("/app/dispatch");
    }

    // Surligner la case du calendrier sous le curseur
    const slot = el?.closest?.("[data-drop]") || null;
    if (lastSlot.current !== slot) {
      clearSlot();
      if (slot) { slot.classList.add("ext-drop-over"); lastSlot.current = slot; }
    }
  }, [navigate]);

  const onUp = useCallback((e) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const p = pending.current;
    pending.current = null;
    document.body.classList.remove("proj-dragging");
    setActive(false);
    setHoverGroup(null);
    const slot = lastSlot.current;
    clearSlot();
    if (p?.active && slot && dropRef.current) {
      const parts = (slot.getAttribute("data-drop") || "").split("|");
      dropRef.current({ project: p.project, type: parts[0], plombierId: parts[1], jour: parts[2], heure: parts[3] });
    }
  }, [onMove]);

  const startDrag = useCallback((project, e) => {
    pending.current = { project, startX: e.clientX, startY: e.clientY, active: false, navigated: false };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [onMove, onUp]);

  return (
    <Ctx.Provider value={{ startDrag, registerDrop, dragging: active, hoverGroup }}>
      {children}
      <div ref={ghostRef} className="proj-drag-ghost" style={{ display: active ? "flex" : "none" }}>
        {label}
      </div>
    </Ctx.Provider>
  );
}
