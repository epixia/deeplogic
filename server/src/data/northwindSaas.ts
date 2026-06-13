// Sample semantic model: "Northwind SaaS" (B2B subscription).
// Neutral fictional brand — not a real company.

import type { SemanticModel, KPI, Connector, Dimension, Measure } from '../types.js';
import {
  mulberry32,
  dailyDates,
  genSeries,
  genBreakdown,
  currentPrevious,
  round0,
  round2,
} from './_generator.js';

const SEED = 0x4e07d; // stable seed for Northwind SaaS
const DAYS = 90;
const END = new Date('2026-06-12T00:00:00Z');
const dates = dailyDates(DAYS, END);

const rand = mulberry32(SEED);

const dimensions: Dimension[] = [
  { id: 'plan', name: 'Plan', values: ['Starter', 'Growth', 'Pro', 'Enterprise'] },
  { id: 'region', name: 'Region', values: ['NA', 'EMEA', 'APAC', 'LATAM'] },
  { id: 'segment', name: 'Segment', values: ['SMB', 'Mid-Market', 'Enterprise'] },
];

const connectors: Connector[] = [
  {
    id: 'c-powerbi',
    name: 'Power BI Service',
    kind: 'powerbi',
    tables: ['Subscriptions', 'Usage', 'Accounts', 'Calendar'],
    status: 'connected',
  },
  {
    id: 'c-hubspot',
    name: 'HubSpot CRM',
    kind: 'hubspot',
    tables: ['Contacts', 'Deals', 'Tickets'],
    status: 'connected',
  },
  {
    id: 'c-sqlserver',
    name: 'Billing SQL Server',
    kind: 'sqlserver',
    tables: ['dbo.Invoices', 'dbo.Plans', 'dbo.Seats'],
    status: 'syncing',
  },
];

const measures: Measure[] = [
  { id: 'm-mrr', name: 'MRR', expression: 'SUM(Subscriptions[MRR])', format: 'currency' },
  {
    id: 'm-active',
    name: 'Active Users',
    expression: 'DISTINCTCOUNT(Usage[UserId])',
    format: 'number',
  },
  {
    id: 'm-churn',
    name: 'Churn %',
    expression: 'DIVIDE([Churned MRR],[MRR])',
    format: 'percent',
  },
  { id: 'm-nps', name: 'NPS', expression: 'AVERAGE(Survey[NPS])', format: 'number' },
];

// --- KPI: MRR (currency, up good) -----------------------------------------
const mrrSeries = genSeries(
  dates,
  { base: 880000, trendPerDay: 1400, weeklyAmp: 0.02, noiseAmp: 0.02, round: round0, min: 0 },
  rand
);
const mrr: KPI = {
  id: 'k-mrr',
  name: 'MRR',
  format: 'currency',
  ...currentPrevious(mrrSeries),
  goodDirection: 'up',
  series: mrrSeries,
  byDimension: genBreakdown(currentPrevious(mrrSeries).current, dimensions, 'currency', rand, 'down'),
};

// --- KPI: Active Users (number, up good) ----------------------------------
const activeSeries = genSeries(
  dates,
  { base: 18600, trendPerDay: 28, weeklyAmp: 0.14, noiseAmp: 0.05, round: round0, min: 0 },
  rand
);
const active: KPI = {
  id: 'k-active',
  name: 'Active Users',
  format: 'number',
  ...currentPrevious(activeSeries),
  goodDirection: 'up',
  series: activeSeries,
  byDimension: genBreakdown(currentPrevious(activeSeries).current, dimensions, 'number', rand, 'down'),
};

// --- KPI: Churn % (percent, DOWN good) — PLANTED ANOMALY ------------------
// Sharp spike 4 days ago (churn is bad when up), concentrated in "Enterprise" plan.
const churnSeries = genSeries(
  dates,
  {
    base: 2.3,
    trendPerDay: -0.001,
    weeklyAmp: 0.05,
    noiseAmp: 0.06,
    round: round2,
    min: 0,
    anomaly: { daysAgo: 4, multiplier: 2.8 },
  },
  rand
);
const churnBreakdownDims = dimensions.map((d) =>
  d.id === 'plan' ? { ...d, anomalyLabel: 'Enterprise' } : d
);
const churn: KPI = {
  id: 'k-churn',
  name: 'Churn %',
  format: 'percent',
  ...currentPrevious(churnSeries),
  goodDirection: 'down',
  series: churnSeries,
  byDimension: genBreakdown(
    currentPrevious(churnSeries).current,
    churnBreakdownDims,
    'percent',
    rand,
    'up'
  ),
};

// --- KPI: NPS (number, up good) -------------------------------------------
const npsSeries = genSeries(
  dates,
  { base: 58, trendPerDay: 0.02, weeklyAmp: 0.02, noiseAmp: 0.04, round: round0, min: 0 },
  rand
);
const nps: KPI = {
  id: 'k-nps',
  name: 'NPS',
  format: 'number',
  ...currentPrevious(npsSeries),
  goodDirection: 'up',
  series: npsSeries,
  byDimension: genBreakdown(currentPrevious(npsSeries).current, dimensions, 'number', rand, 'down'),
};

export const northwindSaas: SemanticModel = {
  id: 'northwind-saas',
  name: 'Northwind SaaS',
  source: 'sample',
  connectors,
  dimensions,
  measures,
  kpis: [mrr, active, churn, nps],
  dateRange: { start: dates[0], end: dates[dates.length - 1] },
};

// Date of the planted Churn % anomaly (4 days from end).
export const northwindAnomalyDate = dates[dates.length - 1 - 4];
