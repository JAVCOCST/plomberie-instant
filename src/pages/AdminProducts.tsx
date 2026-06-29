import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuoteListConfig } from '@/hooks/useQuoteListConfig';
import { Package, TrendingUp, TrendingDown, RefreshCw, Link2, CheckCircle2, XCircle, Loader2, Plus, Save, Settings, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const UNIT_OPTIONS = ['paquet', 'pi.l.', 'pi²', 'unité', 'rouleau', 'tube', 'gallon', 'sac', 'boîte'];

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FN_BASE = `https://${PROJECT_ID}.supabase.co/functions/v1`;

const sectionStyle: React.CSSProperties = {
  background: 'rgba(20,20,40,0.6)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)',
  padding: 20, marginBottom: 16,
};
const thSt: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', color: '#6b7280', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
};
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', borderRadius: 4, padding: '4px 8px', fontSize: 12, width: 70,
  textAlign: 'right', fontFamily: 'monospace', outline: 'none',
};
const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px',
  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
  transition: 'all 0.2s',
};
const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', borderRadius: 4, padding: '4px 6px', fontSize: 11, outline: 'none',
  cursor: 'pointer', maxWidth: 160,
  WebkitAppearance: 'none', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b7280'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', paddingRight: 20,
};
const textInputStyle: React.CSSProperties = {
  ...inputStyle, textAlign: 'left', width: '100%', fontSize: 11,
};

async function callFn(name: string, body: Record<string, unknown>, params = '') {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  const res = await fetch(`${FN_BASE}/${name}${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Local overrides stored per QB product Id
interface ProductOverrides {
  [qbId: string]: { brand?: string; line?: string; unit?: string; supplier?: string; coverage?: string; coverageUnit?: string; coverageTypes?: string[]; supabaseId?: string };
}

const AdminProducts: React.FC = () => {
  const isMobile = useIsMobile();
  const [qbStatus, setQbStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading');
  const [qbRealm, setQbRealm] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [qbProducts, setQbProducts] = useState<any[]>([]);
  const [qbCustomers, setQbCustomers] = useState<any[]>([]);
  const [syncMsg, setSyncMsg] = useState('');
  const [creatingQbItem, setCreatingQbItem] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [qbAccounts, setQbAccounts] = useState<any[]>([]);
  // Listes partagées avec la soumission — source unique Supabase, migration
  // legacy depuis localStorage transparente, sync realtime entre les deux pages.
  const listsCfg = useQuoteListConfig();
  const suppliers = listsCfg.suppliers;
  const setSuppliers = listsCfg.setSuppliers;
  const gammes = listsCfg.gammes;
  const setGammes = listsCfg.setGammes;
  const marques = listsCfg.marques;
  const setMarques = listsCfg.setMarques;
  const typesCouverture = listsCfg.coverageTypes;
  const setTypesCouverture = listsCfg.setCoverageTypes;
  const [newSupplier, setNewSupplier] = useState('');
  const [overrides, setOverrides] = useState<ProductOverrides>(() => {
    try { return JSON.parse(localStorage.getItem('qb_product_overrides') || '{}'); } catch { return {}; }
  });

  // Settings panel lists
  const [showSettings, setShowSettings] = useState(false);
  const [newGamme, setNewGamme] = useState('');
  const [newMarque, setNewMarque] = useState('');
  const [newTypeCouverture, setNewTypeCouverture] = useState('');

  const [newItem, setNewItem] = useState({
    name: '', description: '', sku: '', unitPrice: '', purchaseCost: '',
    itemType: 'Service', incomeAccountId: '', expenseAccountId: '', supplier: '',
  });
  const [editingPrices, setEditingPrices] = useState<Record<string, { unitPrice?: string; purchaseCost?: string }>>({});
  const [savingPrice, setSavingPrice] = useState<string | null>(null);

  const updateQbPrice = async (qbId: string) => {
    const edits = editingPrices[qbId];
    if (!edits) return;
    setSavingPrice(qbId);
    try {
      const payload: Record<string, unknown> = { type: 'update_product', qbId };
      if (edits.unitPrice !== undefined) payload.unitPrice = edits.unitPrice;
      if (edits.purchaseCost !== undefined) payload.purchaseCost = edits.purchaseCost;
      const data = await callFn('quickbooks-sync', payload);
      if (data.success && data.item) {
        setQbProducts(prev => prev.map(p => String(p.Id) === qbId ? { ...p, UnitPrice: data.item.UnitPrice, PurchaseCost: data.item.PurchaseCost } : p));
        setEditingPrices(prev => { const next = { ...prev }; delete next[qbId]; return next; });
        setSyncMsg(`✅ Prix mis à jour pour ${data.item.Name}`);
      } else {
        setSyncMsg(`❌ ${data.error || 'Erreur de mise à jour'}`);
      }
    } catch { setSyncMsg('❌ Erreur réseau'); }
    setSavingPrice(null);
  };

  // Overrides : encore en local (clé séparée non partagée avec la soumission).
  useEffect(() => {
    localStorage.setItem('qb_product_overrides', JSON.stringify(overrides));
  }, [overrides]);
  // Suppliers / gammes / marques / typesCouverture sont persistés par
  // useQuoteListConfig (Supabase quote_list_config) — plus rien à faire ici.

  const addSupplier = () => {
    const name = newSupplier.trim();
    if (name && !suppliers.includes(name)) {
      setSuppliers(prev => [...prev, name].sort());
      setNewSupplier('');
    }
  };

  const updateOverride = (qbId: string, field: string, value: string) => {
    setOverrides(prev => {
      const updated = { ...prev, [qbId]: { ...prev[qbId], [field]: value } };
      // Persist to Supabase
      const ov = updated[qbId];
      saveOverrideToDb(qbId, ov);
      return updated;
    });
  };

  const updateOverrideCoverageTypes = (qbId: string, coverageTypes: string[]) => {
    setOverrides(prev => {
      const updated = { ...prev, [qbId]: { ...prev[qbId], coverageTypes } };
      saveOverrideToDb(qbId, updated[qbId]);
      return updated;
    });
  };

  // Save product metadata to Supabase qb_products table
  const saveOverrideToDb = async (qbId: string, ov: ProductOverrides[string]) => {
    try {
      await (supabase as any).from('qb_products')
        .update({
          brand: ov.brand || null,
          gamme: ov.line || null,
          coverage_types: ov.coverageTypes || [],
          supplier: ov.supplier || null,
          coverage_value: ov.coverage ? Number(ov.coverage) : null,
          coverage_unit: ov.coverageUnit || 'pi2',
        })
        .eq('qb_id', qbId);
    } catch (e) {
      console.error('Error saving override to DB:', e);
    }
  };

  // Auto-sync from QuickBooks on mount (falls back to cached DB data if sync fails)
  const autoSynced = useRef(false);

  const loadCached = useCallback(async () => {
    const { data: products } = await (supabase as any).from('qb_products').select('*').order('name');
    if (products && products.length > 0) {
      setQbProducts(products.map((p: any) => ({
        Id: p.qb_id, Name: p.name, Type: p.type,
        UnitPrice: p.unit_price, PurchaseCost: p.purchase_cost,
        Sku: p.sku, Description: p.description,
        IncomeAccountRef: p.income_account_name ? { name: p.income_account_name } : null,
        ExpenseAccountRef: p.expense_account_name ? { name: p.expense_account_name } : null,
        Active: p.active,
      })));
      // Hydrate overrides from DB columns
      const dbOverrides: ProductOverrides = {};
      products.forEach((p: any) => {
        const qbId = p.qb_id;
        const existing = overrides[qbId] || {};
        dbOverrides[qbId] = {
          ...existing,
          brand: existing.brand || p.brand || '',
          line: existing.line || p.gamme || '',
          supplier: existing.supplier || p.supplier || '',
          coverage: existing.coverage || (p.coverage_value ? String(p.coverage_value) : ''),
          coverageUnit: existing.coverageUnit || p.coverage_unit || 'pi²',
          coverageTypes: existing.coverageTypes?.length ? existing.coverageTypes : (p.coverage_types || []),
        };
      });
      setOverrides(prev => ({ ...prev, ...dbOverrides }));
    }
    const { data: customers } = await (supabase as any).from('qb_customers').select('*').order('display_name');
    if (customers && customers.length > 0) {
      setQbCustomers(customers.map((c: any) => ({
        Id: c.qb_id, DisplayName: c.display_name,
        CompanyName: c.company_name,
        PrimaryEmailAddr: c.email ? { Address: c.email } : null,
        PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : null,
        Mobile: c.mobile ? { FreeFormNumber: c.mobile } : null,
        BillAddr: c.bill_address ? { Line1: c.bill_address } : null,
        Balance: c.balance,
      })));
    }
  }, []);

  useEffect(() => { loadCached(); }, [loadCached]);

  const checkStatus = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setQbStatus('disconnected'); return; }
      const data = await callFn('quickbooks-auth', {}, '?action=status');
      if (data.connected) {
        setQbStatus('connected');
        setQbRealm(data.realm_id || '');
        // Auto-sync on first load
        if (!autoSynced.current) {
          autoSynced.current = true;
          setSyncing('products');
          try {
            const prodData = await callFn('quickbooks-sync', { type: 'products' });
            if (prodData.items) setQbProducts(prodData.items);
            const custData = await callFn('quickbooks-sync', { type: 'customers' });
            if (custData.customers) setQbCustomers(custData.customers);
          } catch { /* fall back to cached */ }
          setSyncing(null);
        }
      }
      else { setQbStatus('disconnected'); }
    } catch { setQbStatus('disconnected'); }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (session) checkStatus();
    });
    checkStatus();
    return () => subscription.unsubscribe();
  }, [checkStatus]);

  const startOAuth = async () => {
    const redirectUri = `https://soumission.toituresvb.ca/admin/products`;
    const data = await callFn('quickbooks-auth', { redirect_uri: redirectUri }, '?action=authorize');
    if (data.auth_url) { localStorage.setItem('qb_state', data.state); window.location.href = data.auth_url; }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code'); const realmId = params.get('realmId');
    if (code && realmId) {
      const redirectUri = `https://soumission.toituresvb.ca/admin/products`;
      callFn('quickbooks-auth', { code, realm_id: realmId, redirect_uri: redirectUri }, '?action=callback')
        .then((data) => {
          if (data.success) { setQbStatus('connected'); setQbRealm(realmId); setSyncMsg('✅ QuickBooks connecté avec succès!'); }
          window.history.replaceState({}, '', '/admin/products');
        });
    }
  }, []);

  const syncData = async (type: 'products' | 'customers') => {
    setSyncing(type); setSyncMsg('');
    try {
      const data = await callFn('quickbooks-sync', { type });
      if (type === 'products') { setQbProducts(data.items || []); setSyncMsg(`✅ ${data.count || 0} produits synchronisés`); }
      else { setQbCustomers(data.customers || []); setSyncMsg(`✅ ${data.count || 0} clients synchronisés`); }
    } catch { setSyncMsg('❌ Erreur de synchronisation'); }
    setSyncing(null);
  };

  const createQbProduct = async () => {
    if (!newItem.name.trim()) return;
    setCreatingQbItem(true);
    try {
      const data = await callFn('quickbooks-sync', {
        type: 'create_product', name: newItem.name.trim(),
        description: newItem.description || undefined, sku: newItem.sku || undefined,
        unitPrice: newItem.unitPrice ? Number(newItem.unitPrice) : 0,
        purchaseCost: newItem.purchaseCost ? Number(newItem.purchaseCost) : undefined,
        itemType: newItem.itemType,
        incomeAccountId: newItem.incomeAccountId || undefined, expenseAccountId: newItem.expenseAccountId || undefined,
      });
      if (data.success && data.item) {
        setQbProducts(prev => [...prev, data.item]);
        // Save supplier as local override
        if (newItem.supplier) {
          const qbId = String(data.item.Id);
          setOverrides(prev => ({ ...prev, [qbId]: { ...prev[qbId], supplier: newItem.supplier } }));
        }
        setSyncMsg(`✅ Produit "${data.item.Name}" créé dans QuickBooks`);
        setNewItem({ name: '', description: '', sku: '', unitPrice: '', purchaseCost: '', itemType: 'Service', incomeAccountId: '', expenseAccountId: '', supplier: '' });
        setShowCreateForm(false);
      } else {
        const detail = data.details?.Fault?.Error?.[0]?.Detail || data.error || 'Création échouée';
        setSyncMsg(`❌ Erreur: ${detail}`);
      }
    } catch { setSyncMsg('❌ Erreur lors de la création'); }
    setCreatingQbItem(false);
  };

  const fetchAccounts = useCallback(async () => {
    if (qbStatus !== 'connected') return;
    try { const data = await callFn('quickbooks-sync', { type: 'accounts' }); setQbAccounts(data.accounts || []); }
    catch { /* silent */ }
  }, [qbStatus]);
  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  return (
    <div style={{ margin: '0 auto', padding: '16px 12px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            <Package size={16} style={{ verticalAlign: -3, marginRight: 6, color: '#a5b4fc' }} />
            Liste de produits
          </h1>
          <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
            Catalogue QuickBooks
          </p>
        </div>
        <button onClick={() => setShowSettings(!showSettings)} style={{
          ...btnStyle, padding: '6px 10px', fontSize: 11,
          background: showSettings ? 'rgba(165,180,252,0.2)' : 'rgba(255,255,255,0.06)',
          color: showSettings ? '#a5b4fc' : '#9ca3af',
          border: `1px solid ${showSettings ? 'rgba(165,180,252,0.3)' : 'rgba(255,255,255,0.1)'}`,
        }}>
          <Settings size={12} /> Config
        </button>
      </div>

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div style={{ ...sectionStyle, borderColor: 'rgba(165,180,252,0.2)', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#a5b4fc', margin: 0 }}>
              <Settings size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> Configuration des listes
            </h3>
            <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {/* Types de couverture */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Types de couverture</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {typesCouverture.map(t => (
                  <span key={t} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
                    background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)',
                    borderRadius: 6, fontSize: 10, color: '#fbbf24', fontWeight: 600,
                  }}>
                    {t}
                    <button onClick={() => setTypesCouverture(prev => prev.filter(x => x !== t))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={newTypeCouverture} onChange={e => setNewTypeCouverture(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newTypeCouverture.trim()) { setTypesCouverture(prev => [...prev, newTypeCouverture.trim()]); setNewTypeCouverture(''); } }}
                  placeholder="Nouveau type…" style={{ ...inputStyle, width: '100%', textAlign: 'left', fontSize: 11 }} />
                <button onClick={() => { if (newTypeCouverture.trim()) { setTypesCouverture(prev => [...prev, newTypeCouverture.trim()]); setNewTypeCouverture(''); } }}
                  disabled={!newTypeCouverture.trim()} style={{ ...btnStyle, padding: '4px 8px', fontSize: 10, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>
                  <Plus size={10} />
                </button>
              </div>
            </div>
            {/* Marques */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Marques</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {marques.map(m => (
                  <span key={m} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
                    background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)',
                    borderRadius: 6, fontSize: 10, color: '#34d399', fontWeight: 600,
                  }}>
                    {m}
                    <button onClick={() => setMarques(prev => prev.filter(x => x !== m))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={newMarque} onChange={e => setNewMarque(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newMarque.trim()) { setMarques(prev => [...prev, newMarque.trim()]); setNewMarque(''); } }}
                  placeholder="Nouvelle marque…" style={{ ...inputStyle, width: '100%', textAlign: 'left', fontSize: 11 }} />
                <button onClick={() => { if (newMarque.trim()) { setMarques(prev => [...prev, newMarque.trim()]); setNewMarque(''); } }}
                  disabled={!newMarque.trim()} style={{ ...btnStyle, padding: '4px 8px', fontSize: 10, background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}>
                  <Plus size={10} />
                </button>
              </div>
            </div>
            {/* Gammes */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Gammes</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {gammes.map(g => (
                  <span key={g} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
                    background: 'rgba(165,180,252,0.1)', border: '1px solid rgba(165,180,252,0.2)',
                    borderRadius: 6, fontSize: 10, color: '#a5b4fc', fontWeight: 600,
                  }}>
                    {g}
                    <button onClick={() => setGammes(prev => prev.filter(x => x !== g))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={newGamme} onChange={e => setNewGamme(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newGamme.trim()) { setGammes(prev => [...prev, newGamme.trim()]); setNewGamme(''); } }}
                  placeholder="Nouvelle gamme…" style={{ ...inputStyle, width: '100%', textAlign: 'left', fontSize: 11 }} />
                <button onClick={() => { if (newGamme.trim()) { setGammes(prev => [...prev, newGamme.trim()]); setNewGamme(''); } }}
                  disabled={!newGamme.trim()} style={{ ...btnStyle, padding: '4px 8px', fontSize: 10, background: 'rgba(165,180,252,0.15)', color: '#a5b4fc', border: '1px solid rgba(165,180,252,0.2)' }}>
                  <Plus size={10} />
                </button>
              </div>
            </div>
            {/* Fournisseurs */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Fournisseurs</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {suppliers.map(s => (
                  <span key={s} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
                    background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)',
                    borderRadius: 6, fontSize: 10, color: '#a78bfa', fontWeight: 600,
                  }}>
                    {s}
                    <button onClick={() => setSuppliers(prev => prev.filter(x => x !== s))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="text" value={newSupplier} onChange={e => setNewSupplier(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addSupplier(); }}
                  placeholder="Nouveau fournisseur…" style={{ ...inputStyle, width: '100%', textAlign: 'left', fontSize: 11 }} />
                <button onClick={addSupplier}
                  disabled={!newSupplier.trim()} style={{ ...btnStyle, padding: '4px 8px', fontSize: 10, background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
                  <Plus size={10} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── QB Connection status (moved to top) ── */}
      <div style={{ ...sectionStyle, borderColor: qbStatus === 'connected' ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'linear-gradient(135deg, #2CA01C, #108000)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800, color: '#fff',
            }}>QB</div>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>QuickBooks Online</h3>
              <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
                {qbStatus === 'connected' ? `Connecté — Realm ${qbRealm}` : 'Non connecté'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {qbStatus === 'loading' && <Loader2 size={16} style={{ color: '#6b7280', animation: 'spin 1s linear infinite' }} />}
            {qbStatus === 'connected' && <CheckCircle2 size={16} style={{ color: '#34d399' }} />}
            {qbStatus === 'disconnected' && <XCircle size={16} style={{ color: '#f87171' }} />}
          </div>
        </div>

        {qbStatus === 'disconnected' && (
          <button onClick={startOAuth} style={{
            ...btnStyle, marginTop: 12, background: 'linear-gradient(135deg, #2CA01C, #108000)', color: '#fff',
          }}>
            <Link2 size={14} /> Connecter QuickBooks
          </button>
        )}

        {qbStatus === 'connected' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button onClick={() => syncData('products')} disabled={!!syncing} style={{
              ...btnStyle, padding: '6px 12px', fontSize: 11,
              background: 'rgba(165,180,252,0.1)', color: '#a5b4fc',
              border: '1px solid rgba(165,180,252,0.2)', opacity: syncing ? 0.6 : 1,
            }}>
              {syncing === 'products' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
              Sync Produits
            </button>
            <button onClick={() => syncData('customers')} disabled={!!syncing} style={{
              ...btnStyle, padding: '6px 12px', fontSize: 11,
              background: 'rgba(52,211,153,0.1)', color: '#34d399',
              border: '1px solid rgba(52,211,153,0.2)', opacity: syncing ? 0.6 : 1,
            }}>
              {syncing === 'customers' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
              Sync Clients
            </button>
          </div>
        )}

        {syncMsg && (
          <p style={{ fontSize: 12, color: syncMsg.startsWith('✅') ? '#34d399' : '#f87171', marginTop: 8, margin: '8px 0 0' }}>
            {syncMsg}
          </p>
        )}

      </div>

      {/* ── Main product table (QB products) ── */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0 }}>
            Produits ({qbProducts.length})
          </h3>
          {qbStatus === 'connected' && (
            <button onClick={() => setShowCreateForm(v => !v)} style={{
              ...btnStyle, padding: '6px 12px', fontSize: 11,
              background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
              border: '1px solid rgba(251,191,36,0.2)',
            }}>
              <Plus size={14} /> Ajouter un produit
            </button>
          )}
        </div>

        {/* Create new QB product form */}
        {showCreateForm && (
          <div style={{
            marginBottom: 12, padding: 16, background: 'rgba(251,191,36,0.05)',
            border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8,
          }}>
            <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700, marginBottom: 12 }}>Créer un produit QuickBooks</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px 16px' }}>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Nom *</label>
                <input type="text" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ex: Bardeau IKO Dynasty" style={{ ...inputStyle, width: '100%', textAlign: 'left' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Type</label>
                <select value={newItem.itemType} onChange={e => setNewItem(p => ({ ...p, itemType: e.target.value }))}
                  style={{ ...selectStyle, width: '100%' }}>
                  <option value="Service">Service</option>
                  <option value="NonInventory">Non-inventaire</option>
                  <option value="Inventory">Inventaire</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Description</label>
                <input type="text" value={newItem.description} onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))}
                  placeholder="Description du produit..." style={{ ...inputStyle, width: '100%', textAlign: 'left' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>SKU</label>
                <input type="text" value={newItem.sku} onChange={e => setNewItem(p => ({ ...p, sku: e.target.value }))}
                  placeholder="Ex: IKO-DYN-001" style={{ ...inputStyle, width: '100%', textAlign: 'left' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Prix vendant ($)</label>
                <input type="text" inputMode="decimal" value={newItem.unitPrice} onChange={e => setNewItem(p => ({ ...p, unitPrice: e.target.value }))}
                  placeholder="0.00" style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Prix coûtant ($)</label>
                <input type="text" inputMode="decimal" value={newItem.purchaseCost} onChange={e => setNewItem(p => ({ ...p, purchaseCost: e.target.value }))}
                  placeholder="0.00" style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Fournisseur</label>
                <select value={newItem.supplier} onChange={e => setNewItem(p => ({ ...p, supplier: e.target.value }))}
                  style={{ ...selectStyle, width: '100%' }}>
                  <option value="">— Aucun —</option>
                  {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Compte de revenus</label>
                <select value={newItem.incomeAccountId} onChange={e => setNewItem(p => ({ ...p, incomeAccountId: e.target.value }))}
                  style={{ ...selectStyle, width: '100%' }}>
                  <option value="">— Sélectionner —</option>
                  {qbAccounts.filter((a: any) => a.AccountType === 'Income' || a.AccountType === 'Other Income').map((a: any) => (
                    <option key={a.Id} value={a.Id}>{a.Name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, display: 'block', marginBottom: 3 }}>Compte de dépenses</label>
                <select value={newItem.expenseAccountId} onChange={e => setNewItem(p => ({ ...p, expenseAccountId: e.target.value }))}
                  style={{ ...selectStyle, width: '100%' }}>
                  <option value="">— Sélectionner —</option>
                  {qbAccounts.filter((a: any) => a.AccountType === 'Cost of Goods Sold' || a.AccountType === 'Expense' || a.AccountType === 'Other Expense').map((a: any) => (
                    <option key={a.Id} value={a.Id}>{a.Name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={createQbProduct} disabled={creatingQbItem || !newItem.name.trim()} style={{
                ...btnStyle, padding: '8px 18px',
                background: newItem.name.trim() ? '#fbbf24' : 'rgba(251,191,36,0.2)',
                color: '#000', fontSize: 12,
              }}>
                {creatingQbItem ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
                Créer dans QuickBooks
              </button>
              <button onClick={() => setShowCreateForm(false)} style={{
                ...btnStyle, padding: '8px 14px', background: 'transparent', color: '#6b7280', fontSize: 12, border: 'none',
              }}>Annuler</button>
            </div>
          </div>
        )}

        {qbProducts.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 30 }}>
            Aucun produit. Connectez QuickBooks et synchronisez vos produits.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 8, background: 'rgba(0,0,0,0.2)', maxWidth: '100%' }}>
            <table style={{ minWidth: 1100, borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', position: 'sticky', top: 0, background: 'rgba(10,10,30,0.95)', zIndex: 1 }}>
                  <th style={thSt}>Nom QB</th>
                  <th style={thSt}>Type couv.</th>
                  <th style={thSt}>Marque</th>
                  <th style={thSt}>Gamme</th>
                  <th style={thSt}>Unité</th>
                  <th style={thSt}>Fournisseur</th>
                  <th style={thSt}>Type</th>
                  <th style={{ ...thSt, textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <TrendingUp size={10} style={{ color: '#34d399' }} /> Vendant
                    </span>
                  </th>
                  <th style={{ ...thSt, textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <TrendingDown size={10} style={{ color: '#f87171' }} /> Coût
                    </span>
                  </th>
                  <th style={{ ...thSt, textAlign: 'right' }}>Marge</th>
                  <th style={thSt}>Couv./unité</th>
                  <th style={{ ...thSt, textAlign: 'right' }}>$/unité surf.</th>
                  <th style={thSt}>SKU</th>
                  <th style={thSt}>Actif</th>
                </tr>
              </thead>
              <tbody>
                {qbProducts.map((item: any) => {
                  const id = String(item.Id);
                  const ov = overrides[id] || {};
                  const priceEdits = editingPrices[id] || {};
                  const displaySell = priceEdits.unitPrice !== undefined ? Number(priceEdits.unitPrice) : (item.UnitPrice != null ? Number(item.UnitPrice) : 0);
                  const displayCost = priceEdits.purchaseCost !== undefined ? Number(priceEdits.purchaseCost) : (item.PurchaseCost != null ? Number(item.PurchaseCost) : 0);
                  const margin = displaySell > 0 ? ((displaySell - displayCost) / displaySell * 100) : 0;
                  const marginColor = margin >= 30 ? '#34d399' : margin >= 15 ? '#fbbf24' : '#f87171';
                  const hasEdits = priceEdits.unitPrice !== undefined || priceEdits.purchaseCost !== undefined;
                  const isSaving = savingPrice === id;
                  return (
                    <tr key={id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '6px 10px', color: '#d1d5db', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.Name}
                      </td>
                      <td style={{ padding: '6px 8px', minWidth: 130 }}>
                        {(() => {
                          const selected = ov.coverageTypes || [];
                          return (
                            <div style={{ position: 'relative' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, minHeight: 24 }}>
                                {selected.length === 0 && <span style={{ color: '#4b5563', fontSize: 10 }}>—</span>}
                                {selected.map(t => (
                                  <span key={t} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px',
                                    background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)',
                                    borderRadius: 4, fontSize: 9, color: '#fbbf24', fontWeight: 600, whiteSpace: 'nowrap',
                                  }}>
                                    {t}
                                    <button onClick={() => updateOverrideCoverageTypes(id, selected.filter(x => x !== t))}
                                      style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 10, padding: 0, lineHeight: 1 }}>×</button>
                                  </span>
                                ))}
                              </div>
                              <select value="" onChange={e => {
                                const val = e.target.value;
                                if (val && !selected.includes(val)) {
                                  updateOverrideCoverageTypes(id, [...selected, val]);
                                }
                                e.target.value = '';
                              }} style={{ ...selectStyle, maxWidth: '100%', marginTop: 3, fontSize: 9, padding: '2px 18px 2px 4px' }}>
                                <option value="">+ Ajouter…</option>
                                {typesCouverture.filter(t => !selected.includes(t)).map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '6px 8px', minWidth: 90 }}>
                        <select value={ov.brand || ''} onChange={e => updateOverride(id, 'brand', e.target.value)}
                          style={{ ...selectStyle, maxWidth: 100 }}>
                          <option value="">—</option>
                          {marques.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', minWidth: 100 }}>
                        <select value={ov.line || ''} onChange={e => updateOverride(id, 'line', e.target.value)}
                          style={{ ...selectStyle, maxWidth: 110 }}>
                          <option value="">—</option>
                          {gammes.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <select value={ov.unit || 'paquet'} onChange={e => updateOverride(id, 'unit', e.target.value)}
                          style={{ ...selectStyle, maxWidth: 90 }}>
                          {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', minWidth: 110 }}>
                        <select value={ov.supplier || ''} onChange={e => updateOverride(id, 'supplier', e.target.value)}
                          style={{ ...selectStyle, maxWidth: 120 }}>
                          <option value="">—</option>
                          {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', color: '#9ca3af', fontSize: 10 }}>{item.Type || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <input type="text" inputMode="decimal"
                          value={priceEdits.unitPrice !== undefined ? priceEdits.unitPrice : (item.UnitPrice != null ? Number(item.UnitPrice).toFixed(2) : '')}
                          placeholder="0.00"
                          onChange={e => setEditingPrices(prev => ({ ...prev, [id]: { ...prev[id], unitPrice: e.target.value } }))}
                          style={{ ...inputStyle, fontSize: isMobile ? 16 : inputStyle.fontSize, width: isMobile ? 80 : 70, color: '#34d399', border: priceEdits.unitPrice !== undefined ? '1px solid rgba(52,211,153,0.5)' : undefined }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <input type="text" inputMode="decimal"
                          value={priceEdits.purchaseCost !== undefined ? priceEdits.purchaseCost : (item.PurchaseCost != null ? Number(item.PurchaseCost).toFixed(2) : '')}
                          placeholder="0.00"
                          onChange={e => setEditingPrices(prev => ({ ...prev, [id]: { ...prev[id], purchaseCost: e.target.value } }))}
                          style={{ ...inputStyle, fontSize: isMobile ? 16 : inputStyle.fontSize, width: isMobile ? 80 : 70, color: '#f87171', border: priceEdits.purchaseCost !== undefined ? '1px solid rgba(248,113,113,0.5)' : undefined }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {displaySell > 0 ? (
                          <span style={{
                            color: marginColor, fontWeight: 700, fontSize: 10, fontFamily: 'monospace',
                            background: `${marginColor}15`, padding: '2px 6px', borderRadius: 4,
                          }}>{margin.toFixed(1)}%</span>
                        ) : <span style={{ color: '#4b5563' }}>—</span>}
                      </td>
                      {/* Coverage per unit */}
                      <td style={{ padding: '6px 8px', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input type="text" inputMode="decimal"
                            value={ov.coverage || ''}
                            placeholder="ex: 33.3"
                            onChange={e => updateOverride(id, 'coverage', e.target.value)}
                            style={{ ...inputStyle, width: 55, fontSize: 10 }}
                          />
                          <select value={ov.coverageUnit || 'pi²'}
                            onChange={e => updateOverride(id, 'coverageUnit', e.target.value)}
                            style={{ ...selectStyle, maxWidth: 60, fontSize: 10, padding: '3px 18px 3px 4px' }}>
                            <option value="pi²">pi²</option>
                            <option value="pi.l.">pi.l.</option>
                          </select>
                        </div>
                      </td>
                      {/* Calculated price per unit surface */}
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {ov.coverage && Number(ov.coverage) > 0 ? (() => {
                          const covUnit = ov.coverageUnit || 'pi²';
                          const covNum = Number(ov.coverage);
                          const sellPerUnit = displaySell / covNum;
                          const costPerUnit = displayCost / covNum;
                          return (
                            <div style={{ fontSize: 10, fontFamily: 'monospace', lineHeight: 1.5 }}>
                              <div style={{ color: '#34d399' }}>{sellPerUnit.toFixed(2)} $/{covUnit}</div>
                              <div style={{ color: '#f87171', fontSize: 9 }}>{costPerUnit.toFixed(2)} $/{covUnit}</div>
                            </div>
                          );
                        })() : <span style={{ color: '#4b5563', fontSize: 10 }}>—</span>}
                      </td>
                      <td style={{ padding: '6px 8px', color: '#6b7280', fontFamily: 'monospace', fontSize: 10 }}>{item.Sku || '—'}</td>
                      <td style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: item.Active !== false ? '#34d399' : '#f87171', fontSize: 10, fontWeight: 600 }}>
                          {item.Active !== false ? '✓' : '✗'}
                        </span>
                        {hasEdits && (
                          <button onClick={() => updateQbPrice(id)} disabled={isSaving}
                            title="Sauvegarder dans QuickBooks"
                            style={{
                              background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)',
                              borderRadius: 4, padding: '2px 6px', cursor: 'pointer', display: 'inline-flex',
                              alignItems: 'center', gap: 3, color: '#34d399', fontSize: 9, fontWeight: 700,
                            }}>
                            {isSaving ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={10} />}
                            QB
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── QB Customers ── */}
      {qbCustomers.length > 0 && (
        <div style={sectionStyle}>
          <h4 style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
            Clients QuickBooks ({qbCustomers.length})
          </h4>
          <div style={{ maxHeight: 350, overflowY: 'auto', overflowX: 'auto', borderRadius: 8, background: 'rgba(0,0,0,0.2)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', position: 'sticky', top: 0, background: 'rgba(0,0,0,0.6)' }}>
                  {['Nom', 'Entreprise', 'Courriel', 'Téléphone', 'Cellulaire', 'Adresse', 'Solde'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {qbCustomers.map((cust: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '5px 8px', color: '#d1d5db', fontWeight: 600 }}>{cust.DisplayName}</td>
                    <td style={{ padding: '5px 8px', color: '#9ca3af' }}>{cust.CompanyName || '—'}</td>
                    <td style={{ padding: '5px 8px', color: '#9ca3af', fontSize: 10 }}>{cust.PrimaryEmailAddr?.Address || '—'}</td>
                    <td style={{ padding: '5px 8px', color: '#9ca3af', fontFamily: 'monospace', fontSize: 10 }}>{cust.PrimaryPhone?.FreeFormNumber || '—'}</td>
                    <td style={{ padding: '5px 8px', color: '#9ca3af', fontFamily: 'monospace', fontSize: 10 }}>{cust.Mobile?.FreeFormNumber || '—'}</td>
                    <td style={{ padding: '5px 8px', color: '#6b7280', fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cust.BillAddr ? `${cust.BillAddr.Line1 || ''}${cust.BillAddr.City ? ', ' + cust.BillAddr.City : ''}` : '—'}
                    </td>
                    <td style={{ padding: '5px 8px', color: (cust.Balance || 0) > 0 ? '#f59e0b' : '#9ca3af', fontFamily: 'monospace', fontSize: 10 }}>
                      {cust.Balance != null ? `$${Number(cust.Balance).toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminProducts;
