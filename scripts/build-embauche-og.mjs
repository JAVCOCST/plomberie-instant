/**
 * scripts/build-embauche-og.mjs
 *
 * Génère public/embauche-og.png (1200×630, format paysage Facebook OG) à
 * partir de l'affiche portrait fournie (public/embauche-og-source.png).
 *
 * Stratégie : on garde l'affiche entière centrée (scale-to-fit hauteur)
 * et on étend le ciel bleu sur les côtés via un gradient + halos pour
 * que le canvas paysage ait l'air composé, pas cropé.
 *
 * Pour régénérer :
 *   npm install --no-save @resvg/resvg-js
 *   node scripts/build-embauche-og.mjs
 *   git add public/embauche-og.png
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Source : l'affiche portrait fournie par le client (1024×1536)
const SOURCE = resolve(root, 'public', 'embauche-og-source.png');
const sourceBytes = readFileSync(SOURCE);
const sourceB64 = sourceBytes.toString('base64');
const sourceDataUri = `data:image/png;base64,${sourceB64}`;

// Dimensions cibles : ratio Facebook OG paysage
const W = 1200;
const H = 630;

// L'affiche source est 1024×1536 (ratio 2:3). Scale-to-fit en hauteur :
const SRC_W = 1024;
const SRC_H = 1536;
const imgH = H;                        // 630
const imgW = SRC_W * (H / SRC_H);      // 420
const imgX = (W - imgW) / 2;           // 390 (centré horizontalement)

// Couleurs ciel (matchent l'affiche pour fondre les côtés sans coupure visible)
const C = {
  skyTop: '#1E6AD8',
  skyMid: '#1A5DC9',
  skyBot: '#0E3680',
  shadow: 'rgba(0,0,0,0.35)',
  whiteSoft: 'rgba(255,255,255,0.55)',
};

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="skyV" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${C.skyTop}"/>
      <stop offset="55%"  stop-color="${C.skyMid}"/>
      <stop offset="100%" stop-color="${C.skyBot}"/>
    </linearGradient>
    <!-- Vignette qui fonce les bords lointains pour focus visuel sur l'affiche -->
    <radialGradient id="vignette" cx="50%" cy="50%" r="60%">
      <stop offset="60%"  stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="${C.shadow}"/>
    </radialGradient>
    <!-- Ombre douce sous l'affiche pour la décoller du fond -->
    <filter id="dropShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="12"/>
      <feOffset dx="0" dy="6" result="off"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.45"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Fond ciel qui s'étend sur tout le canvas (couleur identique à l'affiche
       → les côtés se fondent sans cassure visible) -->
  <rect width="${W}" height="${H}" fill="url(#skyV)"/>

  <!-- Affiche client centrée, scale-to-fit en hauteur -->
  <image href="${sourceDataUri}"
         x="${imgX}" y="0" width="${imgW}" height="${imgH}"
         preserveAspectRatio="xMidYMid meet"
         filter="url(#dropShadow)"/>

  <!-- Vignette par-dessus tout pour le focus -->
  <rect width="${W}" height="${H}" fill="url(#vignette)" pointer-events="none"/>

  <!-- URL discret en bas, sur le panneau ciel droit -->
  <text x="${W - 30}" y="${H - 24}" text-anchor="end"
        font-family="DejaVu Sans" font-size="14" font-weight="normal"
        fill="${C.whiteSoft}" letter-spacing="1">soumission.toituresvb.ca/embauche</text>
</svg>
`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: W },
  font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
});
const png = resvg.render().asPng();
const outPath = resolve(root, 'public', 'embauche-og.png');
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
