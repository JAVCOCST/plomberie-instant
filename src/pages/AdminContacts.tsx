import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Search, Phone, Mail, Building2, Download, Copy, Check, UserPlus } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { buildVCard, fetchPhotoBase64 } from '@/lib/vcard';

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  formatted_address: string | null;
  created_at: string;
  /** Photo URL pulled from the soumission's dynasty_breakdown.contact_photo_url. */
  photo_url?: string | null;
}

interface AppointmentContact {
  soumission_id: string | null;
  client_first_name: string;
  client_last_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  formatted_address: string | null;
  scheduled_at: string;
}

const normalizeEmail = (value?: string | null) => (value || '').trim().toLowerCase();
const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
const toTitleCase = (value: string) => value.split(/\s+/).filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
const isPlaceholderEmail = (value?: string | null) => {
  const email = normalizeEmail(value);
  return !email || email.includes('@soumission.local') || email === 'inconnu@converti.ca';
};
const isPlaceholderLastName = (value?: string | null) => {
  const last = normalizeText(value);
  return !last || last === 'non fourni' || last === 'inconnu';
};
const isPlaceholderFirstName = (value?: string | null) => {
  const first = normalizeText(value);
  return !first || first === 'anonyme' || first === 'inconnu';
};
const parseAppointmentName = (appointment: AppointmentContact) => {
  const parenthesisMatch = appointment.client_first_name?.match(/\(([^)]+)\)/);
  if (parenthesisMatch) {
    const parts = parenthesisMatch[1].trim().split(/\s+/);
    return {
      first: normalizeText(parts[0]),
      last: normalizeText(parts.slice(1).join(' ')),
    };
  }
  return {
    first: normalizeText(appointment.client_first_name),
    last: normalizeText(appointment.client_last_name),
  };
};

const AdminContacts: React.FC = () => {
  const isMobile = useIsMobile();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const all: Contact[] = [];
      const appointments: AppointmentContact[] = [];
      let from = 0;
      const PAGE = 1000;

      while (true) {
        const { data } = await supabase
          .from('soumissions')
          .select('id, first_name, last_name, phone, email, formatted_address, created_at, dynasty_breakdown')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        all.push(...((data as any[]).map(d => ({
          ...d,
          photo_url: (d?.dynasty_breakdown as any)?.contact_photo_url || null,
        })) as Contact[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }

      from = 0;
      while (true) {
        const { data } = await supabase
          .from('appointments')
          .select('soumission_id, client_first_name, client_last_name, client_email, client_phone, formatted_address, scheduled_at, notes')
          .order('scheduled_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        appointments.push(...(data as any[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }

      const parsedAppointments = appointments.map((appointment) => {
        const parsed = parseAppointmentName(appointment);
        return {
          ...appointment,
          parsedFirst: parsed.first,
          parsedLast: parsed.last,
          normalizedEmail: isPlaceholderEmail(appointment.client_email) ? '' : normalizeEmail(appointment.client_email),
          normalizedPhone: normalizePhone(appointment.client_phone),
          normalizedAddress: normalizeText(appointment.formatted_address),
          scheduledAtTs: new Date(appointment.scheduled_at).getTime(),
          // Also extract phone from notes (Google Appointment Schedule stores it there)
          notesPhones: (() => {
            const notes = appointment.client_first_name + ' ' + (appointment as any).notes;
            const matches = (notes || '').match(/\d[\d\s\-().]{6,}\d/g) || [];
            return matches.map(m => m.replace(/\D/g, ''));
          })(),
        };
      });

      const enrichContact = (contact: Contact): Contact => {
        const createdAtTs = new Date(contact.created_at).getTime();
        const normalizedPhone = normalizePhone(contact.phone);
        const normalizedAddress = normalizeText(contact.formatted_address);
        const normalizedRealEmail = isPlaceholderEmail(contact.email) ? '' : normalizeEmail(contact.email);
        const normalizedFirst = normalizeText(contact.first_name);

        const directMatch = parsedAppointments.find(appointment => appointment.soumission_id === contact.id);
        const phoneMatch = !directMatch && normalizedPhone
          ? parsedAppointments.find(appointment => appointment.normalizedPhone === normalizedPhone)
          : undefined;
        const emailMatch = !directMatch && !phoneMatch && normalizedRealEmail
          ? parsedAppointments.find(appointment => appointment.normalizedEmail === normalizedRealEmail)
          : undefined;
        const addressMatch = !directMatch && !phoneMatch && !emailMatch && normalizedAddress
          ? parsedAppointments.find(appointment => {
              if (appointment.normalizedAddress !== normalizedAddress) return false;
              const daysDiff = Math.abs(appointment.scheduledAtTs - createdAtTs) / (1000 * 60 * 60 * 24);
              return daysDiff <= 60;
            })
          : undefined;
        // Phone-in-notes match: soumission phone appears in appointment notes
        const phoneInNotesMatch = !directMatch && !phoneMatch && !emailMatch && !addressMatch && normalizedPhone
          ? parsedAppointments.find(appointment => appointment.notesPhones.includes(normalizedPhone))
          : undefined;
        const nameCandidates = !directMatch && !phoneMatch && !emailMatch && !addressMatch && !phoneInNotesMatch && normalizedFirst && !isPlaceholderFirstName(contact.first_name)
          ? parsedAppointments.filter(appointment => {
              if (appointment.parsedFirst !== normalizedFirst) return false;
              const daysDiff = Math.abs(appointment.scheduledAtTs - createdAtTs) / (1000 * 60 * 60 * 24);
              return daysDiff <= 30;
            }).sort((a, b) => Math.abs(a.scheduledAtTs - createdAtTs) - Math.abs(b.scheduledAtTs - createdAtTs))
          : [];

        const match = directMatch || phoneMatch || emailMatch || addressMatch || phoneInNotesMatch || nameCandidates[0];

        const nextFirstName = isPlaceholderFirstName(contact.first_name) && match?.parsedFirst
          ? toTitleCase(match.parsedFirst)
          : contact.first_name;
        const nextLastName = (!contact.last_name || isPlaceholderLastName(contact.last_name))
          ? (match?.parsedLast ? toTitleCase(match.parsedLast) : '')
          : contact.last_name;
        const nextEmail = normalizedRealEmail || match?.normalizedEmail || '';

        return {
          ...contact,
          first_name: nextFirstName,
          last_name: nextLastName,
          email: nextEmail,
        };
      };

      const enriched = all.map(enrichContact);
      const seen = new Set<string>();
      const unique: Contact[] = [];

      for (const contact of enriched) {
        const keys: string[] = [];
        const email = normalizeEmail(contact.email);
        const phone = normalizePhone(contact.phone);
        const address = normalizeText(contact.formatted_address);

        if (!isPlaceholderEmail(email)) keys.push(`e:${email}`);
        if (phone && phone !== '0000000000') keys.push(`p:${phone}`);
        if (keys.length === 0 && address) keys.push(`a:${address}`);
        if (keys.length === 0) continue;
        if (keys.some(key => seen.has(key))) continue;

        keys.forEach(key => seen.add(key));
        unique.push(contact);
      }

      setContacts(unique);
      setLoading(false);
    };

    fetch();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.formatted_address?.toLowerCase().includes(q)
    );
  }, [contacts, search]);

  // Shared vCard builder (without photo) — used for the bulk export so we
  // don't trigger N image downloads when a user exports thousands of contacts.
  const generateVCard = (c: Contact) => buildVCard({
    first_name: c.first_name,
    last_name: c.last_name,
    phone: c.phone,
    email: c.email,
    formatted_address: c.formatted_address,
  });

  const downloadVCard = async (c: Contact) => {
    // For single-contact downloads we embed the photo (Street View capture)
    // when available so iPhone shows it on caller ID.
    const photo = c.photo_url ? await fetchPhotoBase64(c.photo_url) : null;
    const vcf = buildVCard({
      first_name: c.first_name,
      last_name: c.last_name,
      phone: c.phone,
      email: c.email,
      formatted_address: c.formatted_address,
    }, photo);
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const displayLast = isPlaceholderLastName(c.last_name) ? '' : c.last_name;
    a.download = `${c.first_name}${displayLast ? '_' + displayLast : ''}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllVCards = () => {
    const vcf = filtered.map(generateVCard).join('\r\n');
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts_toitures_vb.vcf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div style={{ padding: isMobile ? '12px' : '20px 24px 60px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserPlus size={18} style={{ color: '#a5b4fc' }} /> Contacts
          </h1>
          <p style={{ fontSize: 11, color: '#6b7280', margin: '2px 0 0' }}>{filtered.length} contact{filtered.length > 1 ? 's' : ''}</p>
        </div>
        <button onClick={downloadAllVCards}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', borderRadius: 10, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Download size={14} /> Exporter tout (.vcf)
        </button>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#4b5563' }} />
        <input
          type="text"
          placeholder="Rechercher un contact…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 10, padding: '10px 14px 10px 38px', fontSize: isMobile ? 16 : 13, outline: 'none' }}
        />
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: '#4b5563' }}>Chargement…</div>}

      {/* Contact cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(c => (
          <div key={c.id} style={{
            background: 'rgba(20,20,40,0.6)', borderRadius: 12, padding: isMobile ? '14px 14px' : '14px 18px',
            border: '1px solid rgba(255,255,255,0.06)', transition: 'border-color 0.15s',
          }}>
            {/* Header row (avatar + name + action) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {c.photo_url ? (
                <img
                  src={c.photo_url}
                  alt={`${c.first_name} ${c.last_name}`}
                  loading="lazy"
                  style={{
                    width: 48, height: 48, borderRadius: '50%', objectFit: 'cover',
                    border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0,
                    background: 'rgba(0,0,0,0.3)',
                  }}
                />
              ) : (
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#a5b4fc', fontWeight: 800, fontSize: 16,
                }}>
                  {(c.first_name?.[0] || '?').toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.first_name}{!isPlaceholderLastName(c.last_name) ? ` ${c.last_name}` : ''}
              </div>
              <button onClick={() => downloadVCard(c)}
                title="Ajouter au téléphone"
                style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <UserPlus size={12} /> {isMobile ? '.vcf' : 'Ajouter au téléphone'}
              </button>
            </div>

            {/* Info rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {c.phone && c.phone !== '000-000-0000' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href={`tel:${c.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#34d399', textDecoration: 'none', flex: 1 }}>
                    <Phone size={13} style={{ flexShrink: 0 }} /> {c.phone}
                  </a>
                  <button onClick={() => copyToClipboard(c.phone, `ph-${c.id}`)}
                    style={{ background: 'none', border: 'none', color: copiedId === `ph-${c.id}` ? '#34d399' : '#4b5563', cursor: 'pointer', padding: 4 }}>
                    {copiedId === `ph-${c.id}` ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}

              {c.email && !isPlaceholderEmail(c.email) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href={`mailto:${c.email}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#60a5fa', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Mail size={13} style={{ flexShrink: 0 }} /> {c.email}
                  </a>
                  <button onClick={() => copyToClipboard(c.email, `em-${c.id}`)}
                    style={{ background: 'none', border: 'none', color: copiedId === `em-${c.id}` ? '#34d399' : '#4b5563', cursor: 'pointer', padding: 4 }}>
                    {copiedId === `em-${c.id}` ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}

              {c.formatted_address && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9ca3af' }}>
                  <Building2 size={13} style={{ flexShrink: 0, color: '#fbbf24' }} />
                  <span>Proprio – {c.formatted_address}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#4b5563', fontSize: 13 }}>Aucun contact trouvé</div>
      )}
    </div>
  );
};

export default AdminContacts;
