import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import Login from "./Login";
import Layout from "./Layout";
import Placeholder from "./pages/Placeholder";
import Dispatch from "./pages/Dispatch";
import Catalogue from "./pages/Catalogue";
import Soumission from "./pages/Soumission";
import Timesheets from "./pages/Timesheets";
import BonsTravail from "./pages/BonsTravail";
import Conditions from "./pages/Conditions";
import Confidentialite from "./pages/Confidentialite";
import { NAV_GROUPS } from "./nav";

// Pages réelles (sinon placeholder). Clé = url.
const REAL_PAGES = {
  "/app/dispatch": <Dispatch />,
  "/app/products": <Catalogue />,
  "/app/quote": <Soumission />,
  "/app/timesheets": <Timesheets />,
  "/app/bons": <BonsTravail />,
};

// Toutes les pages du menu, à plat, pour générer les routes.
const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <div className="wrapper">
        <div className="auth">
          <div className="card">
            <p className="loading">Chargement…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Pages légales publiques (requises par Intuit / QuickBooks) */}
      <Route path="/conditions" element={<Conditions />} />
      <Route path="/confidentialite" element={<Confidentialite />} />

      <Route
        path="/login"
        element={session ? <Navigate to="/app" replace /> : <Login />}
      />

      <Route
        path="/app"
        element={session ? <Layout /> : <Navigate to="/login" replace />}
      >
        {ALL_ITEMS.map((item) => {
          const element = REAL_PAGES[item.url] || <Placeholder title={item.title} />;
          return item.end ? (
            <Route key={item.url} index element={element} />
          ) : (
            <Route
              key={item.url}
              path={item.url.replace("/app/", "")}
              element={element}
            />
          );
        })}
      </Route>

      <Route path="*" element={<Navigate to={session ? "/app" : "/login"} replace />} />
    </Routes>
  );
}
