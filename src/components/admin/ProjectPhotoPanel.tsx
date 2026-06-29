import React, { useCallback, useMemo, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Camera, Upload, Crop as CropIcon, Trash2, FolderOpen, X, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getSignedQuotePdfUrl } from '@/lib/pdf-storage';
import { toast } from 'sonner';

interface DocFile { name: string; url: string; size: number }

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Existing documents — used as a picker source */
  documents: DocFile[];
  /** Called when a fresh upload should also be added to the documents list */
  onUploadedToDocs?: (file: DocFile) => void;
  /** Render the photo prominently (large hero) */
  large?: boolean;
}

const createImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });

async function getCroppedBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas blob failed')), 'image/jpeg', 0.92);
  });
}

async function uploadBlob(blob: Blob, name: string): Promise<string | null> {
  const safeName = `project-photos/${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
  const { error } = await supabase.storage.from('quote-pdfs').upload(safeName, file, { upsert: true, contentType: file.type });
  if (error) { toast.error('Téléversement échoué'); return null; }
  return (await getSignedQuotePdfUrl(safeName)) || null;
}

const ProjectPhotoPanel: React.FC<Props> = ({ value, onChange, documents, onUploadedToDocs, large = false }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  // Crop dialog state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  const imageFiles = useMemo(
    () => documents.filter(d => /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(d.name)),
    [documents],
  );

  const onCropComplete = useCallback((_: Area, areaPx: Area) => setCroppedArea(areaPx), []);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Veuillez choisir une image'); return; }
    setBusy(true);
    try {
      const url = await uploadBlob(file, file.name);
      if (!url) return;
      onChange(url);
      onUploadedToDocs?.({ name: file.name, url, size: file.size });
    } finally { setBusy(false); }
  };

  const openCrop = async () => {
    if (!value) return;
    try {
      const resp = await fetch(value);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      setCropSrc(objUrl);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch {
      toast.error('Impossible de charger l\'image');
    }
  };

  const applyCrop = async () => {
    if (!cropSrc || !croppedArea) return;
    setBusy(true);
    try {
      const blob = await getCroppedBlob(cropSrc, croppedArea);
      const url = await uploadBlob(blob, `photo_projet_${Date.now()}.jpg`);
      if (url) {
        onChange(url);
        onUploadedToDocs?.({ name: `photo_projet_${Date.now()}.jpg`, url, size: blob.size });
        toast.success('Recadrage enregistré');
      }
      URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
    } catch (e) {
      console.error(e);
      toast.error('Échec du recadrage');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ margin: '24px 0' }}>
      {value ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="project-photo-hover" style={{ position: 'relative', width: large ? 440 : 160, maxWidth: '100%' }}>
            <img src={value} alt="Projet" style={{
              width: '100%', height: 'auto', objectFit: 'contain', borderRadius: 0,
              display: 'block',
            }} />
            <div className="project-photo-actions" style={{
              position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6,
              opacity: 0, transition: 'opacity 180ms ease',
            }}>
              <button type="button" onClick={openCrop} disabled={busy} title="Recadrer" style={overlayIconBtn()}>
                <CropIcon size={16} />
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} title="Remplacer (ordinateur)" style={overlayIconBtn()}>
                <Upload size={16} />
              </button>
              <button type="button" onClick={() => setPicking(true)} disabled={busy || imageFiles.length === 0}
                title={imageFiles.length === 0 ? 'Aucune image dans la gestion documentaire' : 'Choisir dans documents'}
                style={overlayIconBtn()}>
                <FolderOpen size={16} />
              </button>
              <button type="button" onClick={() => onChange(null)} disabled={busy} title="Retirer" style={overlayIconBtn('danger')}>
                <Trash2 size={16} />
              </button>
            </div>
            <style>{`.project-photo-hover:hover .project-photo-actions { opacity: 1 !important; }`}</style>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Camera size={14} style={{ color: '#a5b4fc' }} />
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', margin: 0, letterSpacing: 0.3 }}>Photo du projet</h3>
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}
            style={emptyBtn}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
            Choisir une image sur mon ordinateur
          </button>
          <button type="button" onClick={() => setPicking(true)} disabled={busy || imageFiles.length === 0}
            style={{ ...emptyBtn, opacity: imageFiles.length === 0 ? 0.5 : 1 }}>
            <FolderOpen size={14} /> Choisir dans la gestion documentaire ({imageFiles.length})
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await handleFile(f);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }} />

      {/* PICKER */}
      {picking && (
        <div onClick={() => setPicking(false)} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14, color: '#fff', fontWeight: 700 }}>Choisir une image</h4>
              <button onClick={() => setPicking(false)} style={iconBtn}><X size={16} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              {imageFiles.map(f => (
                <button key={f.url} type="button"
                  onClick={() => { onChange(f.url); setPicking(false); }}
                  style={{
                    background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: 4, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                  <img src={f.url} alt={f.name} style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 6 }} />
                  <span style={{ fontSize: 9, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CROP */}
      {cropSrc && (
        <div style={overlayStyle}>
          <div style={{ ...modalStyle, width: 640, maxWidth: '95vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 14, color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CropIcon size={14} /> Recadrer la photo
              </h4>
              <button onClick={() => { URL.revokeObjectURL(cropSrc); setCropSrc(null); }} style={iconBtn}><X size={16} /></button>
            </div>
            <div style={{ position: 'relative', width: '100%', height: 360, background: '#000', borderRadius: 8, overflow: 'hidden' }}>
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>Zoom</span>
              <input type="range" min={1} max={4} step={0.05} value={zoom}
                onChange={e => setZoom(Number(e.target.value))} style={{ flex: 1 }} />
              <button type="button" onClick={applyCrop} disabled={busy} style={btnStyle('primary')}>
                {busy ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />}
                Appliquer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const btnStyle = (variant?: 'primary' | 'danger'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: '1px solid ' + (variant === 'primary' ? 'rgba(99,102,241,0.4)' : variant === 'danger' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'),
  background: variant === 'primary' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : variant === 'danger' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)',
  color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#f87171' : '#d1d5db',
});
const overlayIconBtn = (variant?: 'primary' | 'danger'): React.CSSProperties => ({
  width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent',
  color: variant === 'danger' ? '#fca5a5' : '#fff',
  textShadow: '0 1px 3px rgba(0,0,0,0.7)',
  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.7))',
});
const emptyBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '10px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  border: '1px dashed rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.03)', color: '#a5b4fc',
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const modalStyle: React.CSSProperties = {
  background: 'rgba(15,15,40,0.98)', borderRadius: 14, padding: 16,
  border: '1px solid rgba(99,102,241,0.3)', width: 560, maxWidth: '95vw',
  boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
};
const iconBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff', borderRadius: 6, width: 28, height: 28, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

export default ProjectPhotoPanel;