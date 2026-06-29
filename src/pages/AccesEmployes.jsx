import { useEffect, useMemo, useState } from "react";
import { UserPlus, Loader2, Check, KeyRound } from "lucide-react";
import { supabase } from "../supabaseClient";

export default function AccesEmployes() {
  const [plombiers, setPlombiers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [plombierId, setPlombierId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    const [pl, pr] = await Promise.all([
      supabase.from("pi_plombiers").select("id,name").order("name"),
      supabase.from("pi_profiles").select("plombier_id,role"),
    ]);
    setPlombiers(pl.data || []);
    setProfiles(pr.data || []);
  };
  useEffect(() => { load(); }, []);

  const linkedIds = useMemo(
    () => new Set(profiles.filter((p) => p.role === "employee" && p.plombier_id).map((p) => p.plombier_id)),
    [profiles]
  );

  const create = async () => {
    setMsg(""); setErr("");
    if (!plombierId) return setErr("Choisis un plombier.");
    if (!email.trim()) return setErr("Courriel requis.");
    if (password.length < 6) return setErr("Mot de passe : 6 caractères minimum.");
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-employee", {
        body: { email: email.trim(), password, plombier_id: plombierId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMsg(`Compte créé pour ${email}. L'employé peut se connecter avec ce courriel et mot de passe.`);
      setEmail(""); setPassword(""); setPlombierId("");
      load();
    } catch (e) {
      setErr(`Échec : ${e?.message || e}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page acces">
      <h1 className="page-title">Accès employés</h1>
      <p className="page-sub">Crée un compte de connexion pour chaque plombier — il n'aura accès qu'à son dispatch</p>

      {msg && <div className="msg success" style={{ maxWidth: 560, marginTop: "1rem" }}>{msg}</div>}
      {err && <div className="msg error" style={{ maxWidth: 560, marginTop: "1rem" }}>{err}</div>}

      <section className="card-block" style={{ maxWidth: 560 }}>
        <h2 className="block-title"><UserPlus size={16} /> Nouveau compte employé</h2>
        <div className="fld" style={{ marginBottom: "0.8rem" }}>
          <label>Plombier</label>
          <select value={plombierId} onChange={(e) => setPlombierId(e.target.value)}>
            <option value="">— Choisir —</option>
            {plombiers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{linkedIds.has(p.id) ? " (a déjà un compte)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="fld" style={{ marginBottom: "0.8rem" }}>
          <label>Courriel de l'employé</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="employe@exemple.com" />
        </div>
        <div className="fld" style={{ marginBottom: "1rem" }}>
          <label><KeyRound size={13} /> Mot de passe temporaire</label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min. 6 caractères" />
        </div>
        <button className="add-primary" onClick={create} disabled={saving}>
          {saving ? (<><Loader2 size={16} className="spin" /> Création…</>) : (<><Check size={16} /> Créer le compte</>)}
        </button>
      </section>

      <p className="cat-foot">
        L'employé se connecte sur la même adresse (app.plomberieinstant.net) avec ce courriel/mot de passe.
        Il verra uniquement son propre calendrier de dispatch.
      </p>
    </div>
  );
}
