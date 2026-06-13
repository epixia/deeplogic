// rootCauseAttributor — for a flagged KPI/date, find the dimension member that
// most explains the move. We score each member by how far its breakdown value
// deviates from the per-dimension member mean, in the *bad* direction for the
// KPI (a spike for up==good metrics that dropped, etc.). The largest-magnitude
// contributor across all dimensions wins.

import type { SemanticModel, KPI } from '../types.js';
import { mean } from './util.js';

export interface RootCause {
  dimensionId: string;
  dimensionName: string;
  label: string;
  contribution: number; // signed deviation of the member vs its peers
}

/**
 * Attribute a flagged anomaly to a single breakdown member.
 *
 * `direction` is the direction the observed value moved that made it anomalous:
 *  - 'up'   the value spiked above expected (e.g. returns/churn went up — bad)
 *  - 'down' the value fell below expected (e.g. revenue/margin dropped — bad)
 * We look for the member whose breakdown most strongly matches that move.
 */
export function attributeRootCause(
  model: SemanticModel,
  kpi: KPI,
  direction: 'up' | 'down'
): RootCause | null {
  let best: RootCause | null = null;
  let bestScore = -Infinity;

  for (const dim of model.dimensions) {
    const members = kpi.byDimension[dim.id];
    if (!members || members.length === 0) continue;

    const values = members.map((m) => m.value);
    const peerMean = mean(values);

    for (const member of members) {
      // Deviation in the direction that explains an 'up'/'down' anomaly.
      const deviation = member.value - peerMean;
      const score = direction === 'up' ? deviation : -deviation;
      if (score > bestScore) {
        bestScore = score;
        best = {
          dimensionId: dim.id,
          dimensionName: dim.name,
          label: member.label,
          // Signed contribution: how far this member sits from its peers.
          contribution: Math.round((member.value - peerMean) * 100) / 100,
        };
      }
    }
  }

  return best;
}
