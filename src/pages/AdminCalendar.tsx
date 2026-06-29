import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, isToday, parseISO, startOfWeek, endOfWeek, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Clock, MapPin, Phone, Mail, X, User, Trash2, RefreshCw, FileText, Home, DollarSign, ExternalLink } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

/* ── Types ── */
interface Appointment {
  id: string;
  soumission_id: string | null;
  client_first_name: string;
  client_last_name: string;
  client_email: string | null;
  client_phone: string | null;
  formatted_address: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
  google_event_id: string | null;
}

interface LinkedSoumission {
  id: string; seq_number: number; reference_id: string | null;
  first_name: string; last_name: string; email: string; phone: string;
  formatted_address: string | null; product_name: string | null; product_brand: string | null;
  coverage_type: string | null; slope: string | null; status: string;
  high_estimate: number | null; low_estimate: number | null; area_sqft: number | null;
  color: string | null; created_at: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  confirmed: { bg: 'rgba(52,211,153,0.15)', text: '#34d399', label: 'Confirmé' },
  pending: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24', label: 'En attente' },
  cancelled: { bg: 'rgba(248,113,113,0.15)', text: '#f87171', label: 'Annulé' },
  completed: { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa', label: 'Terminé' },
};

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID || 'eeradaaxmqzyvxvmahlf';
const FUNCTIONS_URL = `https://${PROJECT_ID}.supabase.co/functions/v1`;

const fmt = (n: number) => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 });

const AdminCalendar: React.FC = () => {
  const isMobile = useIsMobile();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [linkedSoumission, setLinkedSoumission] = useState<LinkedSoumission | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [gcalConnected, setGcalConnected] = useState<boolean | null>(null);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [mobileView, setMobileView] = useState<'calendar' | 'detail'>('calendar');
  // All soumissions for matching
  const [allSoumissions, setAllSoumissions] = useState<LinkedSoumission[]>([]);

  const [newForm, setNewForm] = useState({
    client_first_name: '', client_last_name: '', client_email: '', client_phone: '',
    formatted_address: '', scheduled_date: '', scheduled_time: '09:00', duration_minutes: 60, notes: '', status: 'confirmed',
  });

  // ── Google Calendar helpers ──
  const callFunction = useCallback(async (fnName: string, body: any, queryParams = '') => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    const resp = await fetch(`${FUNCTIONS_URL}/${fnName}${queryParams}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '' },
      body: JSON.stringify(body),
    });
    return resp.json();
  }, []);

  const checkGcalStatus = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const resp = await fetch(`${FUNCTIONS_URL}/google-calendar-auth?action=status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '' },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      setGcalConnected(data.connected === true);
    } catch { setGcalConnected(false); }
  }, []);

  const syncToGoogleCalendar = useCallback(async (appointment: Appointment, action: 'create' | 'update' | 'delete') => {
    if (!gcalConnected) return;
    try { await callFunction('google-calendar-sync', { action, appointment }); } catch (err) { console.error('Google Calendar sync failed:', err); }
  }, [gcalConnected, callFunction]);

  const handleConnectGoogle = async () => {
    setGcalLoading(true);
    try {
      const redirectUri = `https://soumission.toituresvb.ca/admin/calendar`;
      const data = await callFunction('google-calendar-auth', { redirect_uri: redirectUri }, '?action=authorize');
      if (data.auth_url) { localStorage.setItem('gcal_state', data.state); window.location.href = data.auth_url; }
    } catch (err) { console.error('Failed to start Google auth:', err); }
    setGcalLoading(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code'); const state = params.get('state');
    if (code && state) {
      const savedState = localStorage.getItem('gcal_state');
      if (state === savedState) {
        callFunction('google-calendar-auth', { code, redirect_uri: `https://soumission.toituresvb.ca/admin/calendar` }, '?action=callback')
          .then(() => { localStorage.removeItem('gcal_state'); setGcalConnected(true); window.history.replaceState({}, '', '/admin/calendar'); });
      }
    }
  }, [callFunction]);

  useEffect(() => { checkGcalStatus(); }, [checkGcalStatus]);

  const pullFromGoogleCalendar = useCallback(async () => {
    if (gcalConnected !== true) return;
    try {
      const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
      const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
      await callFunction('google-calendar-sync', { action: 'pull', timeMin: start.toISOString(), timeMax: end.toISOString() });
    } catch (err) { console.error('Google Calendar pull failed:', err); }
  }, [gcalConnected, currentMonth, callFunction]);

  // ── Fetch appointments + soumissions ──
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      await pullFromGoogleCalendar();
      const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
      const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
      const [{ data: apptData }, { data: soumData }] = await Promise.all([
        supabase.from('appointments' as any).select('*').gte('scheduled_at', start.toISOString()).lte('scheduled_at', end.toISOString()).order('scheduled_at', { ascending: true }),
        supabase.from('soumissions').select('*').order('created_at', { ascending: false }).limit(1000),
      ]);
      if (apptData) setAppointments(apptData as any);
      if (soumData) setAllSoumissions(soumData as any);
      setLoading(false);
    };
    fetchData();
  }, [currentMonth, pullFromGoogleCalendar]);

  // ── Match appointment to soumission ──
  const findLinkedSoumission = useCallback((appt: Appointment): LinkedSoumission | null => {
    // 1. Direct link via soumission_id
    if (appt.soumission_id) {
      const direct = allSoumissions.find(s => s.id === appt.soumission_id);
      if (direct) return direct;
    }
    // 2. Match by email
    if (appt.client_email) {
      const emailLower = appt.client_email.toLowerCase().trim();
      const byEmail = allSoumissions.find(s => s.email?.toLowerCase().trim() === emailLower);
      if (byEmail) return byEmail;
    }
    // 3. Match by first name extracted from "30 min with Toitures (Name)" + phone or address
    const parenthesisMatch = appt.client_first_name?.match(/\(([^)]+)\)/);
    const apptFirstName = parenthesisMatch
      ? (parenthesisMatch[1].trim().split(/\s+/)[0] || '').toLowerCase()
      : (appt.client_first_name || '').toLowerCase().trim();

    if (apptFirstName) {
      const candidates = allSoumissions.filter(s => s.first_name?.toLowerCase().trim() === apptFirstName);
      if (candidates.length === 1) return candidates[0];
      // If multiple, try to narrow by phone or address
      if (appt.client_phone) {
        const phoneDigits = appt.client_phone.replace(/\D/g, '');
        const byPhone = candidates.find(s => s.phone?.replace(/\D/g, '') === phoneDigits);
        if (byPhone) return byPhone;
      }
      if (appt.formatted_address && candidates.length > 0) {
        const addrLower = appt.formatted_address.toLowerCase();
        const byAddr = candidates.find(s => s.formatted_address?.toLowerCase().includes(addrLower.slice(0, 15)));
        if (byAddr) return byAddr;
      }
      if (candidates.length > 0) return candidates[0];
    }
    return null;
  }, [allSoumissions]);

  // Load linked soumission when appointment is selected
  useEffect(() => {
    if (selectedAppointment) {
      setLinkedSoumission(findLinkedSoumission(selectedAppointment));
    } else {
      setLinkedSoumission(null);
    }
  }, [selectedAppointment, findLinkedSoumission]);

  // ── Calendar grid ──
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const start = startOfWeek(monthStart, { weekStartsOn: 1 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const getAppointmentsForDay = (day: Date) => appointments.filter(a => isSameDay(parseISO(a.scheduled_at), day));

  // ── Mobile: week view ──
  const [mobileWeekStart, setMobileWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const mobileWeekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(mobileWeekStart, i)), [mobileWeekStart]);

  // ── CRUD ──
  const [createError, setCreateError] = useState('');
  const handleCreate = async () => {
    if (!newForm.client_first_name || !newForm.scheduled_date) return;
    setCreateError('');
    const scheduled_at = `${newForm.scheduled_date}T${newForm.scheduled_time || '09:00'}:00`;
    const { error, data: inserted } = await supabase.from('appointments' as any).insert({
      client_first_name: newForm.client_first_name, client_last_name: newForm.client_last_name,
      client_email: newForm.client_email, client_phone: newForm.client_phone,
      formatted_address: newForm.formatted_address, scheduled_at,
      duration_minutes: Number(newForm.duration_minutes), notes: newForm.notes, status: newForm.status,
    } as any).select().single();
    if (error) { setCreateError(`Erreur: ${error.message}`); return; }
    if (inserted) {
      syncToGoogleCalendar(inserted as any, 'create');
      setShowNewForm(false);
      setNewForm({ client_first_name: '', client_last_name: '', client_email: '', client_phone: '', formatted_address: '', scheduled_date: '', scheduled_time: '09:00', duration_minutes: 60, notes: '', status: 'confirmed' });
      const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
      const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
      const { data } = await supabase.from('appointments' as any).select('*').gte('scheduled_at', start.toISOString()).lte('scheduled_at', end.toISOString()).order('scheduled_at', { ascending: true });
      if (data) setAppointments(data as any);
    }
  };
  const handleUpdateStatus = async (id: string, status: string) => {
    await supabase.from('appointments' as any).update({ status, updated_at: new Date().toISOString() } as any).eq('id', id);
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    if (selectedAppointment?.id === id) setSelectedAppointment(prev => prev ? { ...prev, status } : null);
  };
  const handleUpdateDate = async (id: string, newDate: string) => {
    await supabase.from('appointments' as any).update({ scheduled_at: newDate, updated_at: new Date().toISOString() } as any).eq('id', id);
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, scheduled_at: newDate } : a));
    if (selectedAppointment?.id === id) setSelectedAppointment(prev => prev ? { ...prev, scheduled_at: newDate } : null);
  };
  const handleDelete = async (id: string) => {
    const appt = appointments.find(a => a.id === id);
    if (appt?.google_event_id) syncToGoogleCalendar(appt, 'delete');
    await supabase.from('appointments' as any).delete().eq('id', id);
    setAppointments(prev => prev.filter(a => a.id !== id));
    setSelectedAppointment(null);
    if (isMobile) setMobileView('calendar');
  };

  const upcoming = useMemo(() =>
    appointments.filter(a => a.status !== 'cancelled' && new Date(a.scheduled_at) >= new Date())
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()).slice(0, 8),
    [appointments]
  );

  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  // Extract clean name from appointment
  const cleanName = (appt: Appointment) => {
    const parenthesisMatch = appt.client_first_name?.match(/\(([^)]+)\)/);
    if (parenthesisMatch) return parenthesisMatch[1].trim();
    return `${appt.client_first_name} ${appt.client_last_name}`.trim();
  };

  const openAppointment = (appt: Appointment) => {
    setSelectedAppointment(appt);
    setShowNewForm(false);
    if (isMobile) setMobileView('detail');
  };

  // ── Client detail card (shared between mobile and desktop) ──
  const renderClientCard = () => {
    if (!selectedAppointment) return null;
    const st = STATUS_COLORS[selectedAppointment.status] || STATUS_COLORS.confirmed;
    const name = cleanName(selectedAppointment);
    const s = linkedSoumission;

    return (
      <div style={{ background: 'rgba(20,20,40,0.6)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: st.bg, color: st.text, padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, border: `1px solid ${st.text}30` }}>{st.label}</span>
              {s && <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>#{s.seq_number}</span>}
            </div>
          </div>
          <button onClick={() => { setSelectedAppointment(null); if (isMobile) setMobileView('calendar'); }}
            style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#6b7280', cursor: 'pointer', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>

        {/* Rendez-vous info */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#d1d5db' }}>
            <Clock size={14} style={{ color: '#a5b4fc', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600 }}>{format(parseISO(selectedAppointment.scheduled_at), "EEEE d MMMM yyyy", { locale: fr })}</div>
              <div style={{ fontSize: 13, color: '#e5e7eb', fontWeight: 700, marginTop: 2 }}>
                {format(parseISO(selectedAppointment.scheduled_at), "HH:mm", { locale: fr })}
                {' → '}
                {format(new Date(new Date(selectedAppointment.scheduled_at).getTime() + selectedAppointment.duration_minutes * 60000), "HH:mm", { locale: fr })}
                <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, marginLeft: 8 }}>({selectedAppointment.duration_minutes} min)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div style={{ padding: '0 18px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(selectedAppointment.client_email || s?.email) && (
            <a href={`mailto:${selectedAppointment.client_email || s?.email}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#60a5fa', textDecoration: 'none', padding: '8px 12px', background: 'rgba(96,165,250,0.06)', borderRadius: 8, border: '1px solid rgba(96,165,250,0.1)' }}>
              <Mail size={14} /> {selectedAppointment.client_email || s?.email}
            </a>
          )}
          {(selectedAppointment.client_phone || s?.phone) && (
            <a href={`tel:${selectedAppointment.client_phone || s?.phone}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#34d399', textDecoration: 'none', padding: '8px 12px', background: 'rgba(52,211,153,0.06)', borderRadius: 8, border: '1px solid rgba(52,211,153,0.1)' }}>
              <Phone size={14} /> {selectedAppointment.client_phone || s?.phone}
            </a>
          )}
          {(selectedAppointment.formatted_address || s?.formatted_address) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#d1d5db', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
              <MapPin size={14} style={{ color: '#fbbf24', flexShrink: 0 }} /> {selectedAppointment.formatted_address || s?.formatted_address}
            </div>
          )}
        </div>

        {/* Linked soumission details */}
        {s && (
          <div style={{ padding: '0 18px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Détails du projet</div>
            <div style={{ background: 'rgba(99,102,241,0.06)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.12)', padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {s.product_name && (
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Produit</div>
                  <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>{s.product_name}</div>
                  {s.product_brand && <div style={{ fontSize: 10, color: '#818cf8' }}>{s.product_brand}</div>}
                </div>
              )}
              {s.coverage_type && (
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Couverture</div>
                  <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>{s.coverage_type}</div>
                </div>
              )}
              {s.area_sqft && (
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Superficie</div>
                  <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>{s.area_sqft.toLocaleString()} pi²</div>
                </div>
              )}
              {s.slope && (
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Pente</div>
                  <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>{s.slope}</div>
                </div>
              )}
              {s.color && (
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Couleur</div>
                  <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>{s.color}</div>
                </div>
              )}
              {(s.high_estimate || s.low_estimate) && (
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Estimation</div>
                  <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
                    {s.low_estimate && s.high_estimate ? `${fmt(s.low_estimate)} – ${fmt(s.high_estimate)}` : s.high_estimate ? fmt(s.high_estimate) : '—'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!s && (
          <div style={{ padding: '0 18px 14px' }}>
            <div style={{ background: 'rgba(251,191,36,0.06)', borderRadius: 8, padding: '10px 14px', border: '1px solid rgba(251,191,36,0.12)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} style={{ color: '#fbbf24' }} />
              <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600 }}>Aucune soumission liée</span>
            </div>
          </div>
        )}

        {/* Notes */}
        {selectedAppointment.notes && (
          <div style={{ padding: '0 18px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Notes</div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#9ca3af', lineHeight: 1.6, border: '1px solid rgba(255,255,255,0.05)' }}>
              {selectedAppointment.notes}
            </div>
          </div>
        )}

        {/* Status buttons */}
        <div style={{ padding: '0 18px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Statut</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_COLORS).map(([key, val]) => (
              <button key={key} onClick={() => handleUpdateStatus(selectedAppointment.id, key)}
                style={{
                  background: selectedAppointment.status === key ? val.bg : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${selectedAppointment.status === key ? val.text : 'rgba(255,255,255,0.08)'}`,
                  color: selectedAppointment.status === key ? val.text : '#6b7280',
                  borderRadius: 8, padding: '6px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}>
                {val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reschedule */}
        <div style={{ padding: '0 18px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Reprogrammer</div>
          <input type="datetime-local" value={selectedAppointment.scheduled_at.slice(0, 16)}
            onChange={e => handleUpdateDate(selectedAppointment.id, new Date(e.target.value).toISOString())}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: isMobile ? 16 : 12, outline: 'none' }} />
        </div>

        {/* Delete */}
        <div style={{ padding: '0 18px 18px' }}>
          <button onClick={() => handleDelete(selectedAppointment.id)}
            style={{ width: '100%', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171', borderRadius: 8, padding: '10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Trash2 size={12} /> Supprimer
          </button>
        </div>
      </div>
    );
  };

  // ── New form (shared) ──
  const renderNewForm = () => (
    <div style={{ background: 'rgba(20,20,40,0.6)', borderRadius: 14, border: '1px solid rgba(99,102,241,0.2)', padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>
          <Plus size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> Nouveau rendez-vous
        </h3>
        <button onClick={() => { setShowNewForm(false); if (isMobile) setMobileView('calendar'); }}
          style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X size={16} /></button>
      </div>
      {[
        { key: 'client_first_name', label: 'Prénom *', type: 'text' },
        { key: 'client_last_name', label: 'Nom', type: 'text' },
        { key: 'client_phone', label: 'Téléphone', type: 'tel' },
        { key: 'client_email', label: 'Courriel', type: 'email' },
        { key: 'formatted_address', label: 'Adresse', type: 'text' },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{f.label}</label>
          <input type={f.type} value={(newForm as any)[f.key]} onChange={e => setNewForm(prev => ({ ...prev, [f.key]: e.target.value }))}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none' }} />
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Date *</label>
          <input type="date" value={newForm.scheduled_date} onChange={e => setNewForm(prev => ({ ...prev, scheduled_date: e.target.value }))}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none' }} />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Heure *</label>
          <input type="time" value={newForm.scheduled_time} onChange={e => setNewForm(prev => ({ ...prev, scheduled_time: e.target.value }))}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none' }} />
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Notes</label>
        <textarea value={newForm.notes} onChange={e => setNewForm(prev => ({ ...prev, notes: e.target.value }))} rows={2}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none', resize: 'vertical' }} />
      </div>
      {createError && <p style={{ fontSize: 11, color: '#f87171', background: 'rgba(248,113,113,0.1)', borderRadius: 6, padding: 8, marginBottom: 10 }}>{createError}</p>}
      <button onClick={handleCreate}
        style={{ width: '100%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', borderRadius: 8, padding: '12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        Créer le rendez-vous
      </button>
    </div>
  );

  // ===================== MOBILE LAYOUT =====================
  if (isMobile) {
    // Detail view (appointment or form)
    if (mobileView === 'detail') {
      return (
        <div style={{ padding: '12px', paddingBottom: 80 }}>
          <button onClick={() => { setMobileView('calendar'); setSelectedAppointment(null); setShowNewForm(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#a5b4fc', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 12, padding: 0 }}>
            <ChevronLeft size={16} /> Calendrier
          </button>
          {showNewForm ? renderNewForm() : renderClientCard()}
        </div>
      );
    }

    // Calendar view (week strip)
    return (
      <div style={{ padding: '12px', paddingBottom: 80 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
            <CalendarDays size={16} style={{ verticalAlign: -2, marginRight: 6, color: '#a5b4fc' }} /> Calendrier
          </h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {gcalConnected === true ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8, padding: '5px 8px', fontWeight: 700 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399' }} /> GCal
              </div>
            ) : gcalConnected === false ? (
              <button onClick={handleConnectGoogle} disabled={gcalLoading}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', borderRadius: 8, padding: '5px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f87171' }} /> {gcalLoading ? '...' : 'GCal'}
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#6b7280', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '5px 8px' }}>
                <RefreshCw size={9} className="animate-spin" /> GCal
              </div>
            )}
            <button onClick={() => { setShowNewForm(true); setSelectedAppointment(null); setMobileView('detail'); }}
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} /> Nouveau
            </button>
          </div>
        </div>

        {/* Week strip nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => setMobileWeekStart(prev => addDays(prev, -7))}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#d1d5db', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={22} strokeWidth={2.5} />
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb', textTransform: 'capitalize' }}>
            {format(mobileWeekStart, "d MMM", { locale: fr })} – {format(addDays(mobileWeekStart, 6), "d MMM yyyy", { locale: fr })}
          </span>
          <button onClick={() => setMobileWeekStart(prev => addDays(prev, 7))}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#d1d5db', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ChevronRight size={22} strokeWidth={2.5} />
          </button>
        </div>

        {/* Week strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 16 }}>
          {mobileWeekDays.map(day => {
            const dayAppts = getAppointmentsForDay(day);
            const today = isToday(day);
            const selected = selectedDate && isSameDay(day, selectedDate);
            return (
              <div key={day.toISOString()} onClick={() => setSelectedDate(day)}
                style={{
                  textAlign: 'center', padding: '8px 4px', borderRadius: 10, cursor: 'pointer',
                  background: selected ? 'rgba(99,102,241,0.2)' : today ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.02)',
                  border: selected ? '1.5px solid rgba(99,102,241,0.5)' : today ? '1.5px solid rgba(52,211,153,0.25)' : '1px solid rgba(255,255,255,0.04)',
                }}>
                <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 600, marginBottom: 2 }}>{format(day, 'EEE', { locale: fr })}</div>
                <div style={{ fontSize: 15, fontWeight: today ? 800 : 600, color: today ? '#34d399' : selected ? '#a5b4fc' : '#d1d5db' }}>{format(day, 'd')}</div>
                {dayAppts.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 4 }}>
                    {dayAppts.slice(0, 3).map((_, i) => (
                      <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#6366f1' }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Day's appointments */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', marginBottom: 10, textTransform: 'capitalize' }}>
            {selectedDate ? format(selectedDate, "EEEE d MMMM", { locale: fr }) : "Aujourd'hui"}
          </div>
          {(selectedDate ? getAppointmentsForDay(selectedDate) : getAppointmentsForDay(new Date())).length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: '#4b5563', fontSize: 12 }}>Aucun rendez-vous</div>
          )}
          {(selectedDate ? getAppointmentsForDay(selectedDate) : getAppointmentsForDay(new Date())).map(a => {
            const st = STATUS_COLORS[a.status] || STATUS_COLORS.confirmed;
            const linked = findLinkedSoumission(a);
            return (
              <div key={a.id} onClick={() => openAppointment(a)}
                style={{
                  background: 'rgba(20,20,40,0.6)', borderRadius: 12, padding: '14px 16px', marginBottom: 8,
                  border: '1px solid rgba(255,255,255,0.06)', borderLeft: `3px solid ${st.text}`, cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{cleanName(a)}</div>
                    {a.client_email && <div style={{ fontSize: 11, color: '#818cf8', marginTop: 1 }}>{a.client_email}</div>}
                  </div>
                  <span style={{ background: st.bg, color: st.text, padding: '2px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700 }}>{st.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#d1d5db' }}>
                  <span style={{ fontWeight: 700 }}><Clock size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{format(parseISO(a.scheduled_at), 'HH:mm')} → {format(new Date(new Date(a.scheduled_at).getTime() + a.duration_minutes * 60000), 'HH:mm')}</span>
                  <span style={{ fontSize: 10, color: '#6b7280' }}>{a.duration_minutes} min</span>
                  {linked && <span style={{ color: '#4ade80', fontWeight: 600 }}>#{linked.seq_number}</span>}
                </div>
                {(a.formatted_address || linked?.formatted_address) && (
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={10} /> {a.formatted_address || linked?.formatted_address}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Upcoming */}
        {upcoming.length > 0 && (!selectedDate || getAppointmentsForDay(selectedDate).length === 0) && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', marginBottom: 10 }}>
              <Clock size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> Prochains rendez-vous
            </div>
            {upcoming.map(a => {
              const st = STATUS_COLORS[a.status] || STATUS_COLORS.confirmed;
              return (
                <div key={a.id} onClick={() => openAppointment(a)}
                  style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${st.text}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#d1d5db' }}>{cleanName(a)}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: st.text, background: st.bg, padding: '2px 6px', borderRadius: 4 }}>{st.label}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>
                    {format(parseISO(a.scheduled_at), "EEE d MMM 'à' HH:mm", { locale: fr })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ===================== DESKTOP LAYOUT =====================
  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
            <CalendarDays size={18} style={{ verticalAlign: -3, marginRight: 8, color: '#a5b4fc' }} /> Calendrier des rendez-vous
          </h1>
          <p style={{ fontSize: 12, color: '#6b7280' }}>Planifiez et gérez vos visites client</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {gcalConnected === true && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8, padding: '6px 12px', fontWeight: 700 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399' }} /> Google Calendar connecté
            </div>
          )}
          {gcalConnected === false && (
            <button onClick={handleConnectGoogle} disabled={gcalLoading}
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', borderRadius: 8, padding: '8px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: gcalLoading ? 0.5 : 1 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171' }} /> {gcalLoading ? 'Connexion...' : 'Google Calendar déconnecté'}
            </button>
          )}
          {gcalConnected === null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7280', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '6px 12px' }}>
              <RefreshCw size={12} className="animate-spin" /> Vérification...
            </div>
          )}
          <button onClick={() => { setShowNewForm(true); setSelectedAppointment(null); }}
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> Nouveau rendez-vous
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>
        {/* Calendar Grid */}
        <div style={{ background: 'rgba(20,20,40,0.6)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <button onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#9ca3af', padding: '6px 10px', cursor: 'pointer' }}>
              <ChevronLeft size={16} />
            </button>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', textTransform: 'capitalize' }}>
              {format(currentMonth, 'MMMM yyyy', { locale: fr })}
            </h2>
            <button onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#9ca3af', padding: '6px 10px', cursor: 'pointer' }}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {dayNames.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', padding: '4px 0' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {calendarDays.map((day) => {
              const dayAppts = getAppointmentsForDay(day);
              const inMonth = isSameMonth(day, currentMonth);
              const today = isToday(day);
              const selected = selectedDate && isSameDay(day, selectedDate);
              return (
                <div key={day.toISOString()}
                  onClick={() => { setSelectedDate(day); setNewForm(prev => ({ ...prev, scheduled_date: format(day, 'yyyy-MM-dd') })); setShowNewForm(true); setSelectedAppointment(null); }}
                  style={{
                    minHeight: 80, padding: 6, borderRadius: 8, cursor: 'pointer',
                    background: selected ? 'rgba(99,102,241,0.15)' : today ? 'rgba(52,211,153,0.06)' : 'rgba(255,255,255,0.02)',
                    border: selected ? '1px solid rgba(99,102,241,0.4)' : today ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(255,255,255,0.04)',
                    opacity: inMonth ? 1 : 0.3, transition: 'all 0.15s ease',
                  }}>
                  <div style={{ fontSize: 11, fontWeight: today ? 800 : 500, color: today ? '#34d399' : selected ? '#a5b4fc' : '#9ca3af', marginBottom: 4 }}>
                    {format(day, 'd')}
                  </div>
                  {dayAppts.slice(0, 3).map(a => {
                    const st = STATUS_COLORS[a.status] || STATUS_COLORS.confirmed;
                    return (
                      <div key={a.id} onClick={e => { e.stopPropagation(); openAppointment(a); }}
                        style={{ background: st.bg, borderRadius: 4, padding: '2px 6px', marginBottom: 2, fontSize: 9, color: st.text, fontWeight: 600, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderLeft: `2px solid ${st.text}` }}>
                        {format(parseISO(a.scheduled_at), 'HH:mm')} {cleanName(a).split(' ')[0]}
                      </div>
                    );
                  })}
                  {dayAppts.length > 3 && <div style={{ fontSize: 8, color: '#6b7280', textAlign: 'center' }}>+{dayAppts.length - 3}</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {showNewForm && renderNewForm()}
          {selectedAppointment && !showNewForm && renderClientCard()}

          {/* Upcoming */}
          <div style={{ background: 'rgba(20,20,40,0.6)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', padding: 18 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12 }}>
              <Clock size={12} style={{ verticalAlign: -2, marginRight: 6, color: '#a5b4fc' }} /> Prochains rendez-vous
            </h3>
            {upcoming.length === 0 && <div style={{ fontSize: 11, color: '#4b5563', textAlign: 'center', padding: 20 }}>Aucun rendez-vous à venir</div>}
            {upcoming.map(a => {
              const st = STATUS_COLORS[a.status] || STATUS_COLORS.confirmed;
              return (
                <div key={a.id} onClick={() => openAppointment(a)}
                  style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${st.text}`, transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#d1d5db' }}>{cleanName(a)}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: st.text, background: st.bg, padding: '2px 6px', borderRadius: 4 }}>{st.label}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>
                    <Clock size={9} style={{ verticalAlign: -1, marginRight: 4 }} />
                    {format(parseISO(a.scheduled_at), "EEE d MMM 'à' HH:mm", { locale: fr })}
                  </div>
                  {a.formatted_address && (
                    <div style={{ fontSize: 10, color: '#4b5563', marginTop: 2 }}>
                      <MapPin size={9} style={{ verticalAlign: -1, marginRight: 4 }} />{a.formatted_address}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminCalendar;
