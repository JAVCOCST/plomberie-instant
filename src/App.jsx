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
import Clients from "./pages/Clients";
import CallsTermines from "./pages/CallsTermines";
import QuickBooks from "./pages/QuickBooks";
import AccesEmployes from "./pages/AccesEmployes";
import EmployeeApp from "./pages/EmployeeApp";
import Conditions from "./pages/Conditions";
import Confidentialite from "./pages/Confidentialite";
import { NAV_GROUPS } from "./nav";

const REAL_PAGES = {
  "/app/dispatch": <Dispatch />,
  "/app/products": <Catalogue />,
  "/app/quote": <Soumission />,
  "/app/timesheets": <Timesheets />,
  "/app/bons": <BonsTravail />,
  "/app/clients": <Clients />,
  "/app/calls-termines": <CallsTermines />,
  "/app/quickbooks": <QuickBooks />,
  "/app/acces": <AccesEmployes />,
};

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const loadProfile = async (sess) => {
      if (sess) {
        const { data } = await supabase
          .from("pi_profiles")
          .select("role, plombier_id")
          .eq("user_id", sess.user.id)
          .maybeSingle();
        if (active) setProfile(data || { role: "employee", plombier_id: null });
      } else if (active) {
        setProfile(null);
      }
      if (active) setReady(true);
    };

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Ne recharger le profil QUE sur une vraie connexion/déconnexion.
      // (Évite de remonter l'app au retour de la caméra → TOKEN_REFRESHED, etc.)
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        loadProfile(s);
      }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!ready) {
    return (
      <div className="wrapper">
        <div className="auth"><div className="card"><p className="loading">Chargement…</p></div></div>
      </div>
    );
  }

  const isAdmin = profile?.role === "admin";

  // Employé connecté : accès uniquement à son dispatch
  if (session && !isAdmin) {
    if (!profile?.plombier_id) {
      return (
        <div className="wrapper">
          <div className="auth"><div className="card portal">
            <h2>Compte non configuré</h2>
            <p>Ton compte n'est pas encore lié à un plombier. Contacte ton administrateur.</p>
            <button onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
          </div></div>
        </div>
      );
    }
    return <EmployeeApp plombierId={profile.plombier_id} />;
  }

  return (
    <Routes>
      <Route path="/conditions" element={<Conditions />} />
      <Route path="/confidentialite" element={<Confidentialite />} />

      <Route path="/login" element={session ? <Navigate to="/app" replace /> : <Login />} />

      <Route path="/app" element={session ? <Layout /> : <Navigate to="/login" replace />}>
        {ALL_ITEMS.map((item) => {
          const element = REAL_PAGES[item.url] || <Placeholder title={item.title} />;
          return item.end ? (
            <Route key={item.url} index element={element} />
          ) : (
            <Route key={item.url} path={item.url.replace("/app/", "")} element={element} />
          );
        })}
      </Route>

      <Route path="*" element={<Navigate to={session ? "/app" : "/login"} replace />} />
    </Routes>
  );
}
