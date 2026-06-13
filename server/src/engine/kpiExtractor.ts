// kpiExtractor — resolve KPI[] from a semantic model.
// Samples already carry fully-formed KPIs (series + breakdowns); we pass those
// through. The function exists as the engine's single entry point for KPIs so
// routes never read model.kpis directly.

import type { SemanticModel, KPI } from '../types.js';

export function extractKpis(model: SemanticModel): KPI[] {
  return model.kpis ?? [];
}

/** Convenience: look up a single KPI by id. */
export function findKpi(model: SemanticModel, kpiId: string): KPI | undefined {
  return extractKpis(model).find((k) => k.id === kpiId);
}
