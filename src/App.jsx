import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export default function App() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Compte créé. Vérifiez vos courriels pour confirmer l'adresse.");
      }
    } catch (err) {
      setError(err?.message || "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

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

  // Vue connecté (portail minimal)
  if (session) {
    return (
      <div className="wrapper">
        <div className="auth">
          <div className="card portal">
            <img src="/logo.png" alt="Plomberie Instant" className="logo-img" />
            <h2>Bienvenue</h2>
            <p>
              Connecté en tant que{" "}
              <span className="email">{session.user.email}</span>
            </p>
            <button onClick={handleLogout} className="btn-secondary">
              <LogoutIcon />
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Vue login / signup
  return (
    <div className="wrapper">
      <div className="auth">
        <div className="card">
          <img src="/logo.png" alt="Plomberie Instant" className="logo-img" />
          <p className="subtitle">
            {mode === "login" ? "Connexion au portail" : "Créer un compte"}
          </p>

          {error && <div className="msg error">{error}</div>}
          {info && <div className="msg success">{info}</div>}

          <form onSubmit={handleSubmit}>
            <label htmlFor="email">Courriel</label>
            <div className="field">
              <MailIcon />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                required
                autoComplete="email"
              />
            </div>

            <label htmlFor="password">Mot de passe</label>
            <div className="field">
              <LockIcon />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </div>

            <button type="submit" disabled={loading}>
              {loading
                ? "Veuillez patienter…"
                : mode === "login"
                ? "Se connecter"
                : "Créer mon compte"}
            </button>
          </form>

          <div className="toggle">
            {mode === "login" ? (
              <>
                Pas encore de compte ?{" "}
                <a
                  onClick={() => {
                    setMode("signup");
                    setError("");
                    setInfo("");
                  }}
                >
                  Créer un compte
                </a>
              </>
            ) : (
              <>
                Déjà un compte ?{" "}
                <a
                  onClick={() => {
                    setMode("login");
                    setError("");
                    setInfo("");
                  }}
                >
                  Se connecter
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- Icônes SVG inline (aucune dépendance, aucun emoji) --- */

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M15 12H4m0 0 3.5-3.5M4 12l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
