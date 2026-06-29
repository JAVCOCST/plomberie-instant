import { useState } from "react";
import { Mail, Lock } from "lucide-react";
import { supabase } from "./supabaseClient";

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

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
              <Mail size={18} />
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
              <Lock size={18} />
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
