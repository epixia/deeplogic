// Agent event generators.
//   ingestEvents  — the ordered pipeline streamed once during ingestion,
//                   covering stages ingest -> connectors -> kpis -> anomaly -> brief.
//   missionEvents — a base list looped for the live Mission Control feed,
//                   referencing the model's REAL detected anomalies.
//
// Both produce deterministic AgentEvent[] (timestamps are assigned at stream
// time by the routes layer; here we stamp them in order for completeness).

import type { SemanticModel, AgentEvent, AgentStage } from '../types.js';
import { mapConnectors } from './connectorMapper.js';
import { extractKpis } from './kpiExtractor.js';
import { detectAnomaliesSync } from './anomalyDetector.js';
import { idFrom, formatValue } from './util.js';

let seq = 0;
function ev(
  agent: string,
  stage: AgentStage,
  message: string,
  status: AgentEvent['status']
): AgentEvent {
  seq += 1;
  return {
    id: idFrom('evt', stage, seq),
    agent,
    stage,
    message,
    status,
    ts: new Date().toISOString(),
  };
}

/** Ordered ingestion pipeline for one model. */
export function ingestEvents(model: SemanticModel): AgentEvent[] {
  const connectors = mapConnectors(model);
  const kpis = extractKpis(model);
  const anomalies = detectAnomaliesSync(model);
  const out: AgentEvent[] = [];

  // Stage: ingest
  out.push(ev('Ingestor', 'ingest', `Opening semantic model "${model.name}"`, 'running'));
  out.push(
    ev(
      'Ingestor',
      'ingest',
      `Parsed ${model.dimensions.length} dimensions, ${model.measures.length} measures`,
      'done'
    )
  );

  // Stage: connectors
  out.push(ev('Connector Mapper', 'connectors', `Mapping ${connectors.length} connectors`, 'running'));
  for (const c of connectors) {
    out.push(
      ev(
        'Connector Mapper',
        'connectors',
        `${c.name} (${c.kind}) — ${c.tables.length} tables ${c.status}`,
        'done'
      )
    );
  }

  // Stage: kpis
  out.push(ev('KPI Extractor', 'kpis', `Resolving ${kpis.length} KPIs`, 'running'));
  for (const k of kpis) {
    out.push(
      ev(
        'KPI Extractor',
        'kpis',
        `${k.name}: ${formatValue(k.current, k.format)} (${k.series.length}-day series)`,
        'done'
      )
    );
  }

  // Stage: anomaly
  out.push(ev('Anomaly Detector', 'anomaly', `Scanning series with trailing-14d z-score`, 'running'));
  if (anomalies.length === 0) {
    out.push(ev('Anomaly Detector', 'anomaly', `No anomalies above threshold`, 'done'));
  } else {
    for (const a of anomalies) {
      out.push(
        ev(
          'Anomaly Detector',
          'anomaly',
          `ALERT: ${a.kpiName} anomaly on ${a.date} → ${a.label} (${a.severity})`,
          'alert'
        )
      );
    }
  }

  // Stage: brief
  out.push(ev('Brief Writer', 'brief', `Drafting root-cause briefs`, 'running'));
  out.push(
    ev(
      'Brief Writer',
      'brief',
      anomalies.length > 0
        ? `Briefs ready for ${anomalies.length} anomaly(ies)`
        : `Control room nominal — no briefs needed`,
      'done'
    )
  );

  return out;
}

/** Base list looped for the live mission feed; references real anomalies. */
export function missionEvents(model: SemanticModel): AgentEvent[] {
  const anomalies = detectAnomaliesSync(model);
  const kpis = extractKpis(model);
  const out: AgentEvent[] = [];

  out.push(ev('Watcher', 'kpis', `Polling ${kpis.length} KPIs across ${model.connectors.length} connectors`, 'running'));

  if (anomalies.length > 0) {
    for (const a of anomalies) {
      out.push(
        ev('Anomaly Detector', 'anomaly', `${a.kpiName}: watching ${a.label} (${a.severity})`, 'alert')
      );
      out.push(
        ev('Brief Writer', 'brief', `Refreshing brief for ${a.kpiName} → ${a.label}`, 'running')
      );
    }
  } else {
    out.push(ev('Anomaly Detector', 'anomaly', `All KPIs within baseline`, 'done'));
  }

  for (const k of kpis) {
    out.push(
      ev('Watcher', 'kpis', `${k.name} steady at ${formatValue(k.current, k.format)}`, 'done')
    );
  }

  out.push(ev('Watcher', 'ingest', `Sync complete — next sweep queued`, 'done'));
  return out;
}
