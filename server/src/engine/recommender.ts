// recommender — map (kpi, dimension member, severity) -> a concrete, sensible
// recommendation. Deterministic; chooses an action template keyed on the KPI's
// semantic role inferred from its name, falling back to a generic playbook.

import type { KPI, Anomaly } from '../types.js';
import type { RootCause } from './rootCause.js';
import { idFrom } from './util.js';

type Rec = Anomaly['recommendation'];

interface Template {
  match: RegExp;
  build: (kpi: KPI, rc: RootCause, sev: Anomaly['severity']) => Omit<Rec, 'id'>;
}

const TEMPLATES: Template[] = [
  {
    match: /return/i,
    build: (kpi, rc, sev) => ({
      title: `Open a returns quality review for ${rc.label}`,
      detail: `Returns are concentrated in ${rc.dimensionName} = ${rc.label}. Pull the last 7 days of ${rc.label} return reasons, flag the top SKUs, and notify the category and fulfilment leads. Hold ${rc.label} promotions until the return rate normalizes.`,
      action: `Notify ${rc.label} ops + freeze promotions`,
    }),
  },
  {
    match: /churn/i,
    build: (kpi, rc) => ({
      title: `Launch a save play for ${rc.label} accounts`,
      detail: `Churn spiked in ${rc.dimensionName} = ${rc.label}. Trigger the retention sequence for at-risk ${rc.label} accounts, route the top-MRR ones to CS for an executive check-in, and review recent product or pricing changes affecting ${rc.label}.`,
      action: `Trigger ${rc.label} retention sequence`,
    }),
  },
  {
    match: /revenue|mrr|sales/i,
    build: (kpi, rc) => ({
      title: `Investigate the ${rc.label} revenue gap`,
      detail: `${kpi.name} softened, driven by ${rc.dimensionName} = ${rc.label}. Compare ${rc.label} traffic, conversion, and average order value against trailing weeks; check for stockouts, pricing errors, or a broken funnel step before escalating.`,
      action: `Audit ${rc.label} funnel + inventory`,
    }),
  },
  {
    match: /margin/i,
    build: (kpi, rc) => ({
      title: `Review margin erosion in ${rc.label}`,
      detail: `${kpi.name} dropped on ${rc.dimensionName} = ${rc.label}. Check discount depth, freight, and COGS movement for ${rc.label}; tighten discount approvals and confirm cost feeds are current.`,
      action: `Tighten ${rc.label} discount approvals`,
    }),
  },
  {
    match: /active|users|nps/i,
    build: (kpi, rc) => ({
      title: `Diagnose the ${rc.label} engagement dip`,
      detail: `${kpi.name} moved on ${rc.dimensionName} = ${rc.label}. Inspect recent releases, onboarding funnels, and support volume for ${rc.label}; roll back or hotfix any regression and re-engage dormant cohorts.`,
      action: `Audit ${rc.label} releases + support`,
    }),
  },
];

const GENERIC: Template['build'] = (kpi, rc) => ({
  title: `Investigate ${kpi.name} shift in ${rc.label}`,
  detail: `${kpi.name} deviated from its baseline, concentrated in ${rc.dimensionName} = ${rc.label}. Validate the data feed, then have the owning team review ${rc.label} for an underlying cause.`,
  action: `Assign ${rc.label} review`,
});

export function recommend(
  kpi: KPI,
  rc: RootCause,
  severity: Anomaly['severity']
): Rec {
  const tpl = TEMPLATES.find((t) => t.match.test(kpi.name));
  const body = (tpl ? tpl.build : GENERIC)(kpi, rc, severity);
  return {
    id: idFrom('rec', kpi.id, rc.dimensionId, rc.label),
    ...body,
  };
}
