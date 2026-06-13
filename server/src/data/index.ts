// Sample model registry. Other agents resolve models via getModel(id).

import type { SemanticModel } from '../types.js';
import { atlasRetail } from './atlasRetail.js';
import { northwindSaas } from './northwindSaas.js';

/** In-memory store of all known models (bundled samples + ingested uploads). */
const store = new Map<string, SemanticModel>();

export const SAMPLES: SemanticModel[] = [atlasRetail, northwindSaas];

for (const m of SAMPLES) store.set(m.id, m);

/** Resolve a model by id (sample or previously registered upload). */
export function getModel(id: string): SemanticModel | undefined {
  return store.get(id);
}

/** Register/overwrite a model (used by the ingest route for uploads). */
export function registerModel(model: SemanticModel): void {
  store.set(model.id, model);
}

/** Lightweight listing for GET /api/models. */
export function listModels(): { id: string; name: string; source: SemanticModel['source'] }[] {
  return Array.from(store.values()).map((m) => ({ id: m.id, name: m.name, source: m.source }));
}
