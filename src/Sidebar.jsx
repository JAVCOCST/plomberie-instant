import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, X } from "lucide-react";
import { supabase } from "./supabaseClient";
import { NAV_GROUPS } from "./nav";
import { useProjectDrag } from "./projectDrag";

const GROUPS_KEY = "pi_sidebar_groups_v1";

function loadGroupState() {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { soumissions: true, operations: false, outils: false, catalogue: false };
}

function activeGroupId(pathname) {
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (pathname === it.url || pathname.startsWith(`${it.url}/`)) return g.id;
    }
  }
  return undefined;
}

export default function Sidebar({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { dragging, hoverGroup } = useProjectDrag();
  const [openGroups, setOpenGroups] = useState(loadGroupState);

  // Ouvre automatiquement le groupe de la route active.
  useEffect(() => {
    const gid = activeGroupId(location.pathname);
    if (gid) setOpenGroups((prev) => (prev[gid] ? prev : { ...prev, [gid]: true }));
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(openGroups));
    } catch {
      /* ignore */
    }
  }, [openGroups]);

  const toggleGroup = (id) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <>
      <div
        className={`sidebar-overlay ${open ? "show" : ""}`}
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-head">
          <img src="/favicon.png" alt="" className="sidebar-logo" />
          <span className="sidebar-brand">Plomberie Instant</span>
          <button className="sidebar-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            // Pendant un glisser de projet, le groupe survolé s'ouvre tout seul.
            const isOpen = !!openGroups[group.id] || (dragging && hoverGroup === group.id);
            const GroupIcon = group.icon;
            return (
              <div key={group.id} className="nav-group" data-nav-group={group.id}>
                <button
                  type="button"
                  className={`group-header ${dragging && hoverGroup === group.id ? "drag-over" : ""}`}
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                >
                  <GroupIcon size={16} className="group-icon" />
                  <span className="group-label">{group.label}</span>
                  <ChevronDown
                    size={16}
                    className={`group-chevron ${isOpen ? "" : "collapsed"}`}
                  />
                </button>

                {isOpen && (
                  <div className="group-items">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <NavLink
                          key={item.url}
                          to={item.url}
                          end={item.end}
                          onClick={onClose}
                          data-nav-item={item.url}
                          className={({ isActive }) =>
                            `nav-item ${isActive ? "active" : ""}`
                          }
                        >
                          <ItemIcon size={18} className="nav-item-icon" />
                          <span>{item.title}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <button className="logout-btn" onClick={logout}>
            <LogOut size={16} />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>
    </>
  );
}
