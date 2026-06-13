// Shared Power BI ingestion helpers (used by both the authed org ingest route
// and the public demo route). Pure functions — no DB, no auth.

import AdmZip from 'adm-zip';
import type { SemanticModel } from './types.js';
import { SAMPLES } from './data/index.js';

let uploadSeq = 0;

/** Slugify a filename into a stable-ish fragment. */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/\.(pbix|pbit)$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'model'
  );
}

/** Title-case a slug for display ("acme-sales" -> "Acme Sales"). */
export function titleize(slug: string): string {
  const t = slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return t || 'Uploaded Model';
}

/** Try to read a human model name out of a Power BI package buffer. */
export function tryReadPbixName(buf: Buffer): string | null {
  try {
    const zip = new AdmZip(buf);
    for (const e of zip.getEntries()) {
      const name = e.entryName;
      if (/DataModelSchema$/i.test(name) || /\.json$/i.test(name)) {
        try {
          const text = e.getData().toString('utf16le') || e.getData().toString('utf8');
          const cleaned = text.replace(/^﻿/, '');
          const json = JSON.parse(cleaned);
          const candidate = (json && (json.name || (json.model && json.model.name))) || null;
          if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        } catch {
          // keep scanning
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Build a SemanticModel for an upload by cloning a sample's shape + renaming. */
export function synthesizeFromUpload(displayName: string): SemanticModel {
  const template = SAMPLES[uploadSeq % SAMPLES.length];
  uploadSeq += 1;
  const clone: SemanticModel = JSON.parse(JSON.stringify(template));
  clone.name = displayName;
  clone.source = 'upload';
  return clone;
}

/** Resolve a bundled sample by id (falls back to the first sample). */
export function resolveSample(sampleId: string): SemanticModel {
  const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];
  const clone: SemanticModel = JSON.parse(JSON.stringify(sample));
  clone.source = 'sample';
  return clone;
}

/** Minimal multipart/form-data parser: extract the first 'file' part. */
export function parseMultipartFile(
  body: Buffer,
  contentType: string
): { filename: string; data: Buffer } | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m ? (m[1] || m[2]).trim() : '';
  if (!boundary) return null;

  const delim = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(delim);
  if (start === -1) return null;
  start += delim.length;
  while (start < body.length) {
    const next = body.indexOf(delim, start);
    if (next === -1) break;
    let s = start;
    if (body[s] === 0x0d && body[s + 1] === 0x0a) s += 2;
    parts.push(body.subarray(s, next));
    start = next + delim.length;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const header = part.subarray(0, headerEnd).toString('utf8');
    const disp = /Content-Disposition:[^\r\n]*/i.exec(header)?.[0] ?? '';
    if (!/filename=/i.test(disp)) continue;
    const nameMatch = /(?:^|[;\s])name="([^"]*)"/i.exec(disp);
    const fileMatch = /filename="([^"]*)"/i.exec(disp);
    const fieldName = nameMatch?.[1] ?? '';
    if (fieldName && fieldName !== 'file') continue;
    const dataStart = headerEnd + 4;
    let dataEnd = part.length;
    if (part[dataEnd - 2] === 0x0d && part[dataEnd - 1] === 0x0a) dataEnd -= 2;
    return { filename: fileMatch?.[1] || 'upload.pbix', data: part.subarray(dataStart, dataEnd) };
  }
  return null;
}

/** Build a SemanticModel from an uploaded multipart body (graceful fallback). */
export function buildModelFromUpload(body: Buffer | null, contentType: string): SemanticModel {
  let displayName = 'Uploaded Model';
  let parsedName: string | null = null;
  try {
    const file = body ? parseMultipartFile(body, contentType) : null;
    if (file) {
      displayName = titleize(slugify(file.filename));
      parsedName = tryReadPbixName(file.data);
    }
  } catch {
    // fall through to synthetic generation
  }
  return synthesizeFromUpload(parsedName || displayName);
}
