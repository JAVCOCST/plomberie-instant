import React, { useEffect, useState } from 'react';
import { useFormContext } from '../../../context/FormContext';
import { Product, coverageToCategory } from '../../../types/roofing';
import { Info } from 'lucide-react';
import CardOption from '../CardOption';
import s from './steps.module.css';

const MOCK_PRODUCTS: Product[] = [
  { id: '1', category: 'shingle', name: 'Cambridge', brand: 'IKO', price_per_sqft: 4.50, colors: ['Dual Black', 'Weatherwood', 'Charcoal Grey', 'Driftwood', 'Dual Grey', 'Dual Brown', 'Earthtone Cedar', 'Harvard Slate'] },
  { id: '2', category: 'shingle', name: 'Dynasty', brand: 'IKO', price_per_sqft: 5.75, colors: ['Granite Black', 'Graphite Black', 'Matte Black', 'Shadow Brown', 'Summit Grey', 'Atlantic Blue', 'Glacier', 'Cornerstone Weatherwood', 'Biscayne', 'Monaco Red', 'Frostone Grey', 'Emerald Green', 'Driftshake', 'Brownstone', 'Sentinel Slate', 'Olde Style Weatherwood'] },
  { id: '6', category: 'shingle', name: 'Royal Estate', brand: 'IKO', price_per_sqft: 6.25, colors: ['Harvest Slate', 'Mountain Slate', 'Shadow Slate', 'Taupe Slate'] },
  { id: '7', category: 'shingle', name: 'Nordic', brand: 'IKO', price_per_sqft: 5.25, colors: ['Granite Black', 'Shadow Brown', 'Summit Grey', 'Glacier', 'Driftshake', 'Olde Style Weatherwood', 'Brownstone', 'Cornerstone Weatherwood', 'Frostone Grey'] },
  { id: '3', category: 'shingle', name: 'Mystique', brand: 'BP', price_per_sqft: 4.75, colors: ['Gris Ardoise', 'Cèdre Rustique', 'Brun Classique', 'Bois Champêtre', 'Ardoise Antique', 'Brun 2 tons', 'Noir 2 tons', 'Brume Matinale', 'Sangria'] },
  { id: '10', category: 'shingle', name: 'Signature', brand: 'BP', price_per_sqft: 6.00, colors: ['Arabica', 'Mesquite', 'Cumin', 'Fjord', 'Criollo', 'Dublin', 'Cortina', 'Muskoka', 'Newport', 'Quinoa', 'Soho', 'Toscana'] },
  { id: '11', category: 'shingle', name: 'Vangard', brand: 'BP', price_per_sqft: 5.50, colors: ['Noir céleste', 'Gris argenté', 'Gris lunaire', 'Galet', 'Brun automnal'] },
  { id: '12', category: 'shingle', name: 'Dakota', brand: 'BP', price_per_sqft: 3.75, colors: ['Gris ardoise', 'Brun 2 tons', 'Noir 2 tons'] },
  { id: '4', category: 'sbs', name: 'Nordic', brand: 'IKO', price_per_sqft: 7.00, colors: ['Noir', 'Blanc', 'Gris'] },
  { id: '5', category: 'sbs', name: 'Manoir', brand: 'BP', price_per_sqft: 8.25, colors: ['Noir', 'Blanc'] },
];

const PRODUCT_INFO: Record<string, { tier: string; desc: string; warranty: string; wind: string }> = {
  // IKO
  Cambridge:    { tier: 'Architectural',  desc: 'Bardeau architectural classique, excellent rapport qualité-prix.',               warranty: 'À vie limitée',  wind: '210 km/h' },
  Dynasty:      { tier: 'Performance',    desc: 'Performance supérieure avec technologie ArmourZone. Résistance aux impacts.',    warranty: 'À vie limitée',  wind: '210 km/h' },
  Nordic:       { tier: 'Performance',    desc: 'Protection haute performance avec un look distinctif.',                          warranty: 'À vie limitée',  wind: '210 km/h' },
  'Royal Estate': { tier: 'Designer',     desc: 'Look premium d\'ardoise naturelle, le plus haut de gamme IKO.',                  warranty: 'À vie limitée',  wind: '210 km/h' },
  // BP
  Mystique:     { tier: 'Stratifié',      desc: 'Stratifié double couche abordable. 9 couleurs tendances. Garantie à vie.',       warranty: 'À vie limitée',  wind: '220 km/h' },
  Signature:    { tier: 'Premium',        desc: 'Équilibre parfait entre design, performance et personnalité. 12 couleurs.',      warranty: 'À vie limitée',  wind: '220 km/h' },
  Vangard:      { tier: 'Résistant IR',   desc: 'Bardeau laminé 42 po, résistance d\'impact Classe 4 (UL2218).',                  warranty: 'À vie limitée',  wind: '220 km/h' },
  Dakota:       { tier: '3 pattes',       desc: 'Bardeau classique à 3 pattes. Performance éprouvée, prix accessible.',           warranty: '25 ans',         wind: '200 km/h' },
};

const StepProduct: React.FC = () => {
  const { data, updateData } = useFormContext();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    fetch('/data/produits-toiture')
      .then(r => r.json())
      .then((d: Product[]) => {
        setProducts(d);
        setLoading(false);
      })
      .catch(() => {
        setProducts(MOCK_PRODUCTS);
        setLoading(false);
      });
  }, []);

  const filtered = products.filter(p => data.coverageType ? p.category === coverageToCategory(data.coverageType) : false);

  return (
    <div className={s.stepContainer}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 className={s.stepTitle}>Produit</h2>
        <button
          type="button"
          onClick={() => setShowInfo(!showInfo)}
          style={{
            background: 'none', border: '1px solid rgba(0,0,0,0.15)', borderRadius: '50%',
            width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--_🎨-color--tokens---tone--medium)',
            transition: 'all 0.2s ease',
          }}
          aria-label="Info sur les types de bardeaux"
        >
          <Info size={14} />
        </button>
      </div>

      {showInfo && (
        <div style={{
          background: 'var(--_🎨-color--tokens---background--lift)',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 12, padding: '16px 20px',
          fontSize: 13, lineHeight: 1.6,
          color: 'var(--_🎨-color--tokens---tone--medium)',
          animation: 'fadeIn 0.2s ease',
        }}>
          <p style={{ fontWeight: 600, color: 'var(--_🎨-color--tokens---tone--strong)', marginTop: 0, marginBottom: 8 }}>
            Comment choisir votre bardeau ?
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Cambridge / Mystique / Dakota</strong> — Excellent rapport qualité-prix pour les budgets modérés.</li>
            <li><strong>Dynasty / Nordic / Signature</strong> — Performance supérieure, meilleure résistance aux intempéries.</li>
            <li><strong>Royal Estate</strong> — Look premium d'ardoise naturelle pour les projets haut de gamme.</li>
            <li><strong>Vangard</strong> — Résistance maximale aux impacts (Classe 4), idéal pour les zones exposées.</li>
          </ul>
        </div>
      )}

      {loading ? (
        <p className={s.stepDesc}>Chargement des produits...</p>
      ) : (
        <div className={s.grid3}>
          {filtered.map(p => {
            const info = PRODUCT_INFO[p.name];
            return (
              <CardOption
                key={p.id}
                title={p.name}
                description={`${p.brand} · ${info?.tier || ''} · ${p.price_per_sqft.toFixed(2)} $/pi²`}
                selected={data.product?.id === p.id}
                onClick={() => updateData({ product: p, color: '' })}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StepProduct;
