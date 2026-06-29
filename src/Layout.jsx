import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";

export default function Layout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="shell">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="main-col">
        <header className="topbar">
          <button
            className="menu-toggle"
            onClick={() => setOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} />
          </button>
          <img src="/favicon.png" alt="Plomberie Instant" className="topbar-logo" />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
