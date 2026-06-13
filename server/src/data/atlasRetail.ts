// Sample semantic model: "Atlas Retail" (omnichannel retail).
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

const SEED = 0xa71a5; // stable seed for Atlas Retail
const DAYS = 90;
const END = new Date('2026-06-12T00:00:00Z');
const dates = dailyDates(DAYS, END);

const rand = mulberry32(SEED);

const dimensions: Dimension[] = [
  { id: 'region', name: 'Region', values: ['North', 'South', 'East', 'West', 'Central'] },
  { id: 'channel', name: 'Channel', values: ['Online', 'In-Store', 'Marketplace', 'Wholesale'] },
  { id: 'category', name: 'Category', values: ['Apparel', 'Home', 'Electronics', 'Grocery', 'Beauty'] },
];

const connectors: Connector[] = [
  {
    id: 'c-powerbi',
    name: 'Power BI Service',
    kind: 'powerbi',
    tables: ['Sales', 'Returns', 'Inventory', 'Calendar'],
    status: 'connected',
  },
  {
    id: 'c-snowflake',
    name: 'Snowflake Warehouse',
    kind: 'snowflake',
    tables: ['FCT_ORDERS', 'FCT_RETURNS', 'DIM_STORE', 'DIM_PRODUCT'],
    status: 'connected',
  },
  {
    id: 'c-salesforce',
    name: 'Salesforce Commerce',
    kind: 'salesforce',
    tables: ['Account', 'Opportunity', 'Case'],
    status: 'syncing',
  },
];

const measures: Measure[] = [
  { id: 'm-revenue', name: 'Revenue', expression: 'SUM(Sales[Amount])', format: 'currency' },
  { id: 'm-orders', name: 'Orders', expression: 'COUNTROWS(Sales)', format: 'number' },
  {
    id: 'm-margin',
    name: 'Margin %',
    expression: 'DIVIDE([Gross Profit],[Revenue])',
    format: 'percent',
  },
  {
    id: 'm-returns',
    name: 'Returns %',
    expression: 'DIVIDE(COUNTROWS(Returns),[Orders])',
    format: 'percent',
  },
];

// --- KPI: Revenue (currency, up good) -------------------------------------
const revSeries = genSeries(
  dates,
  { base: 142000, trendPerDay: 320, weeklyAmp: 0.09, noiseAmp: 0.05, round: round0, min: 0 },
  rand
);
const revenue: KPI = {
  id: 'k-revenue',
  name: 'Revenue',
  format: 'currency',
  ...currentPrevious(revSeries),
  goodDirection: 'up',
  series: revSeries,
  byDimension: genBreakdown(
    currentPrevious(revSeries).current,
    dimensions,
    'currency',
    rand,
    'down'
  ),
};

// --- KPI: Orders (number, up good) ----------------------------------------
const ordSeries = genSeries(
  dates,
  { base: 5200, trendPerDay: 6, weeklyAmp: 0.11, noiseAmp: 0.06, round: round0, min: 0 },
  rand
);
const orders: KPI = {
  id: 'k-orders',
  name: 'Orders',
  format: 'number',
  ...currentPrevious(ordSeries),
  goodDirection: 'up',
  series: ordSeries,
  byDimension: genBreakdown(currentPrevious(ordSeries).current, dimensions, 'number', rand, 'down'),
};

// --- KPI: Margin % (percent, up good) -------------------------------------
const marginSeries = genSeries(
  dates,
  { base: 34.5, trendPerDay: 0.01, weeklyAmp: 0.03, noiseAmp: 0.04, round: round2, min: 0 },
  rand
);
const margin: KPI = {
  id: 'k-margin',
  name: 'Margin %',
  format: 'percent',
  ...currentPrevious(marginSeries),
  goodDirection: 'up',
  series: marginSeries,
  byDimension: genBreakdown(currentPrevious(marginSeries).current, dimensions, 'percent', rand, 'down'),
};

// --- KPI: Returns % (percent, DOWN good) — PLANTED ANOMALY ----------------
// Sharp spike 3 days ago (returns are bad when up), concentrated in "Online".
const returnsSeries = genSeries(
  dates,
  {
    base: 4.2,
    trendPerDay: 0.002,
    weeklyAmp: 0.06,
    noiseAmp: 0.05,
    round: round2,
    min: 0,
    anomaly: { daysAgo: 3, multiplier: 2.4 },
  },
  rand
);
const returnsBreakdownDims = dimensions.map((d) =>
  d.id === 'channel' ? { ...d, anomalyLabel: 'Online' } : d
);
const returns: KPI = {
  id: 'k-returns',
  name: 'Returns %',
  format: 'percent',
  ...currentPrevious(returnsSeries),
  goodDirection: 'down',
  series: returnsSeries,
  byDimension: genBreakdown(
    currentPrevious(returnsSeries).current,
    returnsBreakdownDims,
    'percent',
    rand,
    'up'
  ),
};

export const atlasRetail: SemanticModel = {
  id: 'atlas-retail',
  name: 'Atlas Retail',
  source: 'sample',
  connectors,
  dimensions,
  measures,
  kpis: [revenue, orders, margin, returns],
  dateRange: { start: dates[0], end: dates[dates.length - 1] },
};

// Date of the planted Returns % anomaly (3 days from end).
export const atlasAnomalyDate = dates[dates.length - 1 - 3];
