import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";

/* Autocomplétion d'adresse — Photon (OpenStreetMap), gratuit et sans clé API.
   Biaisé vers le Québec (proximité Granby) et en français. */
function fmt(p) {
  const line = [p.housenumber, p.street || p.name].filter(Boolean).join(" ");
  const parts = [line, p.city || p.town || p.village, p.state, p.postcode].filter(Boolean);
  return parts.join(", ");
}

export default function AddressAutocomplete({ value, onChange, placeholder }) {
  const [q, setQ] = useState(value || "");
  const [sugg, setSugg] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const timer = useRef(null);
  const ctrl = useRef(null);

  useEffect(() => { setQ(value || ""); }, [value]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const search = (text) => {
    if (timer.current) clearTimeout(timer.current);
    if (!text || text.trim().length < 3) { setSugg([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        if (ctrl.current) ctrl.current.abort();
        ctrl.current = new AbortController();
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&lang=fr&limit=6&lat=45.4&lon=-72.73`;
        const r = await fetch(url, { signal: ctrl.current.signal });
        const j = await r.json();
        const items = [];
        const seen = new Set();
        for (const f of j.features || []) {
          const label = fmt(f.properties);
          if (label && !seen.has(label)) { seen.add(label); items.push(label); }
        }
        setSugg(items);
        setOpen(items.length > 0);
      } catch { /* aborted / réseau : on ignore */ }
      finally { setLoading(false); }
    }, 300);
  };

  const handleInput = (text) => { setQ(text); onChange(text); search(text); };
  const pick = (label) => { setQ(label); onChange(label); setOpen(false); setSugg([]); };

  return (
    <div className="addr-ac" ref={boxRef}>
      <div className="addr-ac-field">
        <MapPin size={14} className="addr-ac-icon" />
        <input
          value={q}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (sugg.length) setOpen(true); }}
          placeholder={placeholder || "Commence à taper une adresse…"}
          autoComplete="off"
        />
        {loading && <Loader2 size={14} className="spin addr-ac-load" />}
      </div>
      {open && sugg.length > 0 && (
        <ul className="addr-ac-list">
          {sugg.map((s, i) => (
            <li key={i} onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
              <MapPin size={13} /> <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
