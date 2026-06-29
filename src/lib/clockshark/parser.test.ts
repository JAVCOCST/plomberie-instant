import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseClockSharkTimesheets,
  parseClockSharkJobDetail,
  parseClockShark,
  parseHoursToDecimal,
  parseClockSharkDate,
  filterToitureVB,
  filterByDateRange,
  aggregateByTask,
  aggregateByEmployee,
  totalHours,
  TOITURE_VB_JOB_NAME,
} from './parser';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');
const sampleCsv = readFileSync(join(fixturesDir, 'sample-timesheets.csv'), 'utf8');
const jobDetailCsv = readFileSync(join(fixturesDir, 'job-detail-sample.csv'), 'utf8');

describe('parseHoursToDecimal', () => {
  it('converts H:MM to decimal hours', () => {
    expect(parseHoursToDecimal('4:15')).toBe(4.25);
  });
  it('handles half hours', () => {
    expect(parseHoursToDecimal('40:30')).toBe(40.5);
  });
  it('handles three-quarter hours', () => {
    expect(parseHoursToDecimal('8:45')).toBe(8.75);
  });
  it('returns 0 for "0:00"', () => {
    expect(parseHoursToDecimal('0:00')).toBe(0);
  });
  it('returns 0 for empty string', () => {
    expect(parseHoursToDecimal('')).toBe(0);
  });
  it('returns 0 for null/undefined', () => {
    expect(parseHoursToDecimal(null)).toBe(0);
    expect(parseHoursToDecimal(undefined)).toBe(0);
  });
  it('parses a bare integer string', () => {
    expect(parseHoursToDecimal('8')).toBe(8);
  });
  it('passes a number through, rounded to 2 decimals', () => {
    expect(parseHoursToDecimal(7.5)).toBe(7.5);
    expect(parseHoursToDecimal(1.234)).toBe(1.23);
  });
  it('trims surrounding whitespace', () => {
    expect(parseHoursToDecimal('  6:00  ')).toBe(6);
  });
});

describe('parseClockSharkDate', () => {
  it('parses a weekday-prefixed DD/MM/YYYY date', () => {
    expect(parseClockSharkDate('Sun 15/06/2025')).toBe('2025-06-15');
  });
  it('parses each weekday prefix', () => {
    expect(parseClockSharkDate('Mon 16/06/2025')).toBe('2025-06-16');
    expect(parseClockSharkDate('Sat 21/06/2025')).toBe('2025-06-21');
  });
  it('parses a date without a weekday prefix', () => {
    expect(parseClockSharkDate('15/06/2025')).toBe('2025-06-15');
  });
  it('zero-pads single-digit days and months', () => {
    expect(parseClockSharkDate('Tue 1/2/2025')).toBe('2025-02-01');
  });
  it('treats the first component as the day (Québec order)', () => {
    expect(parseClockSharkDate('Wed 31/12/2025')).toBe('2025-12-31');
  });
  it('passes an ISO date through unchanged', () => {
    expect(parseClockSharkDate('2025-06-15')).toBe('2025-06-15');
  });
  it('returns "" for an empty value', () => {
    expect(parseClockSharkDate('')).toBe('');
  });
  it('returns "" for an unparseable value', () => {
    expect(parseClockSharkDate('Total')).toBe('');
    expect(parseClockSharkDate('not a date')).toBe('');
  });
});

describe('parseClockSharkTimesheets', () => {
  const { entries, warnings } = parseClockSharkTimesheets(sampleCsv);

  it('flattens the matrix into one entry per non-zero day cell', () => {
    expect(entries).toHaveLength(15);
  });
  it('does not emit warnings on a clean export', () => {
    expect(warnings).toEqual([]);
  });
  it('attaches the right employee, ISO date, job and task', () => {
    const first = entries[0];
    expect(first.employee).toBe('Marc Tremblay');
    expect(first.date).toBe('2025-06-15');
    expect(first.customerJob).toBe(TOITURE_VB_JOB_NAME);
    expect(first.task).toBe('Réfection');
    expect(first.hoursDecimal).toBe(8);
    expect(first.hoursHM).toBe('8:00');
  });
  it('skips ClockShark summary rows (Regular / Overtime / Total)', () => {
    expect(entries.some((e) => /regular|overtime|total/i.test(e.customerJob))).toBe(false);
  });
  it('skips zero-hour cells', () => {
    expect(entries.every((e) => e.hoursDecimal > 0)).toBe(true);
  });
});

describe('filterToitureVB', () => {
  const { entries } = parseClockSharkTimesheets(sampleCsv);

  it('keeps only TOITURE VB - TEMPS REFACT entries', () => {
    const vb = filterToitureVB(entries);
    expect(vb).toHaveLength(11);
    expect(totalHours(vb)).toBe(75.75);
  });
  it('is case-insensitive on the job name', () => {
    // Sophie's row uses lowercase "toiture vb - temps refact".
    const vb = filterToitureVB(entries);
    expect(vb.some((e) => e.employee === 'Sophie Gagnon')).toBe(true);
  });
  it('excludes JAVCO Construction jobs', () => {
    const vb = filterToitureVB(entries);
    expect(vb.some((e) => /javco/i.test(e.customerJob))).toBe(false);
  });
});

describe('filterByDateRange', () => {
  const vb = filterToitureVB(parseClockSharkTimesheets(sampleCsv).entries);

  it('returns the first week with inclusive bounds', () => {
    const w1 = filterByDateRange(vb, '2025-06-15', '2025-06-21');
    expect(w1).toHaveLength(8);
    expect(totalHours(w1)).toBe(52.75);
  });
  it('includes the lower bound (start date)', () => {
    const onStart = filterByDateRange(vb, '2025-06-15', '2025-06-15');
    expect(onStart).toHaveLength(2);
    expect(totalHours(onStart)).toBe(12.25);
  });
  it('includes the upper bound (end date)', () => {
    const onEnd = filterByDateRange(vb, '2025-06-21', '2025-06-21');
    expect(onEnd).toHaveLength(1);
    expect(onEnd[0].employee).toBe('Sophie Gagnon');
  });
  it('returns nothing for a range before all entries', () => {
    expect(filterByDateRange(vb, '2025-01-01', '2025-01-31')).toHaveLength(0);
  });
});

describe('aggregateByTask', () => {
  const vb = filterToitureVB(parseClockSharkTimesheets(sampleCsv).entries);

  it('sums hours and counts per task', () => {
    const byTask = aggregateByTask(vb);
    const refection = byTask.find((t) => t.task === 'Réfection');
    expect(refection).toEqual({ task: 'Réfection', hoursDecimal: 48, count: 6 });
  });
  it('sorts tasks by descending hours', () => {
    const byTask = aggregateByTask(vb);
    expect(byTask.map((t) => t.task)).toEqual(['Réfection', 'Installation membrane', 'Soudure']);
  });
  it('preserves the per-task totals', () => {
    const byTask = aggregateByTask(vb);
    expect(byTask.map((t) => [t.task, t.hoursDecimal, t.count])).toEqual([
      ['Réfection', 48, 6],
      ['Installation membrane', 15, 2],
      ['Soudure', 12.75, 3],
    ]);
  });
});

describe('aggregateByEmployee', () => {
  const vb = filterToitureVB(parseClockSharkTimesheets(sampleCsv).entries);

  it('sums hours and counts per employee', () => {
    const byEmp = aggregateByEmployee(vb);
    expect(byEmp).toEqual([
      { employee: 'Marc Tremblay', hoursDecimal: 55, count: 7 },
      { employee: 'Sophie Gagnon', hoursDecimal: 20.75, count: 4 },
    ]);
  });
  it('aggregates across every job when not pre-filtered', () => {
    const all = aggregateByEmployee(parseClockSharkTimesheets(sampleCsv).entries);
    expect(all.find((e) => e.employee === 'Marc Tremblay')).toEqual({
      employee: 'Marc Tremblay', hoursDecimal: 61, count: 8,
    });
  });
});

describe('totalHours', () => {
  it('sums all entries across the export', () => {
    const { entries } = parseClockSharkTimesheets(sampleCsv);
    expect(totalHours(entries)).toBe(105.75);
  });
});

describe('parseClockSharkTimesheets — garde-fou heures journalières', () => {
  // A total row whose label escapes SUMMARY_KEYWORDS must not become an entry:
  // its > 24h cell would overflow hours_decimal (the prod import crash).
  const csv = [
    'Employee: Test Worker,,,,,,,,,',
    '"Customer: Job","Task","Sun 15/06/2025","Mon 16/06/2025","Tue 17/06/2025","Wed 18/06/2025","Thu 19/06/2025","Fri 20/06/2025","Sat 21/06/2025","Total"',
    '"TOITURE VB - TEMPS REFACT","Réfection","8:00","0:00","0:00","0:00","0:00","0:00","0:00","8:00"',
    '"GRAND TOTAL ANNUEL","","2080:00","0:00","0:00","0:00","0:00","0:00","0:00","2080:00"',
  ].join('\n');
  const { entries, warnings } = parseClockSharkTimesheets(csv);

  it('drops day cells over 24h and keeps the real one', () => {
    expect(entries).toHaveLength(1);
    expect(entries[0].hoursDecimal).toBe(8);
  });
  it('records a warning for the dropped cell', () => {
    expect(warnings.some((w) => /24h/.test(w))).toBe(true);
  });
});

describe('parseClockSharkJobDetail', () => {
  const { entries, warnings } = parseClockSharkJobDetail(jobDetailCsv);

  it('parses one entry per punch across all job sections', () => {
    expect(entries).toHaveLength(5); // 1 admin + 4 TOITURE VB punches
    expect(warnings).toEqual([]);
  });
  it('attaches the section job to each punch', () => {
    const vb = filterToitureVB(entries);
    expect(vb).toHaveLength(4);
    expect(vb.every((e) => e.customerJob === TOITURE_VB_JOB_NAME)).toBe(true);
  });
  it('normalizes the employee name (drops leading space and -id suffix)', () => {
    expect(entries.some((e) => e.employee === 'Cote, Dave')).toBe(true);
    expect(entries.some((e) => e.employee === 'Dumas, Eddy')).toBe(true);
    expect(entries.some((e) => /-\d+$/.test(e.employee))).toBe(false);
  });
  it('attaches the Notes: line to the punch above it', () => {
    const note = entries.find((e) => e.employee === 'Cote, Dave' && e.date === '2025-06-16')?.note;
    expect(note).toBe('Trepanier');
  });
  it('reads hours from the Total column and skips Daily Total rows', () => {
    const cote = entries.find((e) => e.employee === 'Cote, Dave' && e.date === '2025-06-16');
    expect(cote?.hoursDecimal).toBe(8);
    expect(entries.some((e) => e.hoursDecimal === 14.5)).toBe(false); // 14:30 daily total
  });
  it('keeps separate punches for the same employee/day/task (summed later by sync)', () => {
    const dumas = entries.filter((e) => e.employee === 'Dumas, Eddy' && e.date === '2025-06-16');
    expect(dumas).toHaveLength(2);
    expect(dumas.map((e) => e.hoursDecimal).sort()).toEqual([1, 5.5]);
  });
});

describe('parseClockShark (auto-detect)', () => {
  it('routes a Job Detail export to the job-detail parser', () => {
    const { entries } = parseClockShark(jobDetailCsv);
    expect(filterToitureVB(entries)).toHaveLength(4);
  });
  it('routes a matrix export to the timesheets parser', () => {
    const { entries } = parseClockShark(sampleCsv);
    expect(entries).toHaveLength(15);
  });
  it('strips a leading UTF-8 BOM before detecting', () => {
    const { entries } = parseClockShark(`﻿${jobDetailCsv}`);
    expect(filterToitureVB(entries)).toHaveLength(4);
  });
});

// Real-data regression: drop the actual ClockShark export at
// __fixtures__/clockshark-real.csv to assert the production numbers
// (≈132 TOITURE VB entries / 694.70h over 12 months). Skipped when absent so
// the suite stays green without committing client data to the repo.
const realFixture = join(fixturesDir, 'clockshark-real.csv');
describe.skipIf(!existsSync(realFixture))('real ClockShark export', () => {
  it('reports 132 TOITURE VB entries totalling 694.70h', () => {
    const csv = readFileSync(realFixture, 'utf8');
    const vb = filterToitureVB(parseClockSharkTimesheets(csv).entries);
    expect(vb).toHaveLength(132);
    expect(totalHours(vb)).toBeCloseTo(694.7, 1);
  });
});
