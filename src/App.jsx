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
        setInfo("Compte créé ! Vérifie tes courriels pour confirmer l'adresse.");
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
        <div className="card">
          <p style={{ textAlign: "center", color: "#64748b" }}>Chargement…</p>
        </div>
      </div>
    );
  }

  // Vue connecté (portail minimal)
  if (session) {
    return (
      <div className="wrapper">
        <div className="card portal">
          <div className="brand">
            <div className="logo">🔧</div>
            <h1>Plomberie Instant</h1>
          </div>
          <h1>Bienvenue 👋</h1>
          <p>
            Connecté en tant que{" "}
            <span className="email">{session.user.email}</span>
          </p>
          <button onClick={handleLogout}>Se déconnecter</button>
        </div>
      </div>
    );
  }

  // Vue login / signup
  return (
    <div className="wrapper">
      <div className="card">
        <div className="brand">
          <div className="logo">🔧</div>
          <h1>Plomberie Instant</h1>
          <p>{mode === "login" ? "Connexion au portail" : "Créer un compte"}</p>
        </div>

        {error && <div className="msg error">{error}</div>}
        {info && <div className="msg success">{info}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Courriel</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@exemple.com"
            required
            autoComplete="email"
          />

          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

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
  );
}
