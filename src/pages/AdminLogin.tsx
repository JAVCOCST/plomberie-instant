import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import vbLogo from '@/assets/vb-logo-white.svg';

const AdminLogin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/admin');
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError('Identifiants invalides');
    } else {
      navigate('/admin');
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0d0d1f 100%)',
      fontFamily: "'Segoe UI', Roboto, Arial, sans-serif",
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <form onSubmit={handleLogin} style={{
        background: 'rgba(30, 30, 60, 0.85)', borderRadius: 16, padding: '40px 36px',
        width: 380, maxWidth: '90vw', border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src={vbLogo} alt="Toitures VB" style={{ width: 220, margin: '0 auto 16px', display: 'block' }} />
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>Portail Admin</h1>
          <p style={{ color: '#9ca3af', fontSize: 13, margin: '8px 0 0' }}>Toitures VB — Gestion des soumissions</p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            color: '#fca5a5', fontSize: 13,
          }}>{error}</div>
        )}

        <div style={{ marginBottom: 16 }}>
          <Label htmlFor="email" style={{ color: '#d1d5db', fontSize: 13, marginBottom: 6, display: 'block' }}>Courriel</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
            required autoComplete="email" placeholder="admin@toituresvb.ca" inputMode="email"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', borderRadius: 10, fontSize: 16 }} />
        </div>

        <div style={{ marginBottom: 24 }}>
          <Label htmlFor="password" style={{ color: '#d1d5db', fontSize: 13, marginBottom: 6, display: 'block' }}>Mot de passe</Label>
          <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
            required autoComplete="current-password" placeholder="••••••••"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', borderRadius: 10, fontSize: 16 }} />
        </div>

        <Button type="submit" disabled={loading} style={{
          width: '100%', height: 44, borderRadius: 10, fontWeight: 600, fontSize: 14,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none',
          color: '#fff', cursor: loading ? 'wait' : 'pointer',
        }}>
          {loading ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </div>
  );
};

export default AdminLogin;
