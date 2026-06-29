import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { generateWarrantyCertificatePdf, generateSpecimenCertificatePdf, type WarrantyData } from '@/lib/warranty-certificate';
import { Download, Trash2, Shield, FileText } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface WarrantyCert {
  id: string;
  certificate_number: string;
  client_name: string;
  project_address: string;
  city: string;
  roof_type: string;
  surface_area: string;
  completion_date: string;
  invoice_number: string;
  warranty_years: number;
  contract_amount: string;
  reference_id: string | null;
  created_at: string;
}

// Helper to bypass generated types for the new table
const warrantyTable = () => (supabase as any).from('warranty_certificates');

const AdminWarranties: React.FC = () => {
  const [certs, setCerts] = useState<WarrantyCert[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  const loadCerts = async () => {
    setLoading(true);
    const { data } = await warrantyTable()
      .select('*')
      .order('created_at', { ascending: false });
    setCerts((data as WarrantyCert[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadCerts(); }, []);

  const handleDownload = async (cert: WarrantyCert) => {
    const wData: WarrantyData = {
      clientName: cert.client_name,
      projectAddress: cert.project_address,
      city: cert.city,
      roofType: cert.roof_type,
      surfaceArea: cert.surface_area,
      completionDate: cert.completion_date,
      invoiceNumber: cert.invoice_number,
      warrantyYears: cert.warranty_years,
      contractAmount: cert.contract_amount,
      referenceId: cert.reference_id || cert.certificate_number,
    };
    await generateWarrantyCertificatePdf(wData, true, cert.certificate_number);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce certificat ?')) return;
    await warrantyTable().delete().eq('id', id);
    setCerts(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Shield size={22} className="text-[#c9a84c]" />
        <h1 className="text-lg md:text-xl font-bold text-white">Certificats de garantie</h1>
        <button
          onClick={() => generateSpecimenCertificatePdf()}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[hsl(230,20%,20%)] bg-[hsl(230,20%,12%)] text-[hsl(230,10%,55%)] hover:text-white hover:border-[#c9a84c] transition-colors"
        >
          <FileText size={12} />
          Spécimen de certificat
        </button>
        <span className="text-xs text-[hsl(230,10%,45%)]">{certs.length} certificat{certs.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[hsl(230,10%,45%)]">Chargement...</div>
      ) : certs.length === 0 ? (
        <div className="text-center py-16 text-[hsl(230,10%,40%)]">
          <Shield size={48} className="mx-auto mb-4 opacity-30" />
          <p>Aucun certificat généré</p>
          <p className="text-xs mt-1">Les certificats apparaîtront ici après génération depuis le générateur de soumission.</p>
        </div>
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {certs.map(cert => (
            <div
              key={cert.id}
              onClick={() => handleDownload(cert)}
              className="bg-[hsl(230,20%,11%)] border border-[hsl(230,20%,16%)] rounded-xl p-4 active:bg-[hsl(230,20%,14%)] cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[#c9a84c] font-mono text-xs mb-1">{cert.certificate_number}</p>
                  <p className="text-white font-semibold text-sm truncate">{cert.client_name}</p>
                  <p className="text-[hsl(230,10%,50%)] text-xs truncate">{cert.project_address}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-[hsl(230,10%,50%)]">{cert.completion_date || '—'}</p>
                  <p className="text-xs text-[hsl(230,10%,40%)]">{cert.contract_amount || '—'}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-[hsl(230,20%,16%)]">
                <span className="text-xs text-[#c9a84c]">{cert.warranty_years} ans</span>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(cert.id); }}
                  className="text-[hsl(230,10%,35%)] hover:text-red-400 p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[hsl(230,20%,9%)] border border-[hsl(230,20%,14%)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(230,20%,14%)] text-[hsl(230,10%,40%)] text-xs">
                <th className="text-left px-4 py-3 font-medium">N° Certificat</th>
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Adresse</th>
                <th className="text-left px-4 py-3 font-medium">Fin travaux</th>
                <th className="text-right px-4 py-3 font-medium">Montant</th>
                <th className="text-center px-4 py-3 font-medium">Garantie</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {certs.map(cert => (
                <tr
                  key={cert.id}
                  onClick={() => handleDownload(cert)}
                  className="border-b border-[hsl(230,20%,12%)] hover:bg-[hsl(230,20%,12%)] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-[#c9a84c]">{cert.certificate_number}</td>
                  <td className="px-4 py-3 text-white font-medium">{cert.client_name}</td>
                  <td className="px-4 py-3 text-[hsl(230,10%,55%)] max-w-[200px] truncate">{cert.project_address}</td>
                  <td className="px-4 py-3 text-[hsl(230,10%,55%)]">{cert.completion_date || '—'}</td>
                  <td className="px-4 py-3 text-right text-[hsl(230,10%,55%)]">{cert.contract_amount || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-xs bg-[hsl(45,60%,20%)] text-[#c9a84c] px-2 py-0.5 rounded-full">
                      {cert.warranty_years} ans
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={e => { e.stopPropagation(); handleDownload(cert); }}
                        className="text-[hsl(230,10%,40%)] hover:text-white p-1"
                        title="Télécharger"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(cert.id); }}
                        className="text-[hsl(230,10%,35%)] hover:text-red-400 p-1"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminWarranties;
