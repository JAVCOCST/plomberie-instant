import { describe, it, expect } from 'vitest';
import { buildToitureModel } from './adapter';
import { buildReportHtml } from './buildReport';

const model = {
  version: 1,
  sections: [
    { pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }], closed: true, pitch: 7, elev: 0, hf: 50, roof_type: 'hip' },
  ],
};

describe('buildReportHtml', () => {
  it('génère un document HTML complet depuis un RoofModel', () => {
    const html = buildReportHtml(buildToitureModel(model), { client: 'Test', address: '1 rue X', devisNo: 'VB-1', pitch: '7/12' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Rapport de toiture');
    expect(html).toContain('<svg');                 // au moins un diagramme
    expect(html).toContain('Surface totale toiture'); // KPI
    expect(html).toContain('Estimation des paquets'); // gaspillage
    expect(html).toContain('Élévation Nord');
    expect(html).toContain('pi²');
    // pas de placeholders non remplacés
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });
});
