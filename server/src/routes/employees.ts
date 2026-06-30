// Employees roster — the company's people, used to dispatch mass AI interviews.
//   GET    /orgs/:orgId/employees
//   POST   /orgs/:orgId/employees            { name, email?, phone?, title?, ... }
//   POST   /orgs/:orgId/employees/import     { employees: [...] }   (CSV / bulk)
//   PATCH  /orgs/:orgId/employees/:id
//   DELETE /orgs/:orgId/employees/:id

import { Router, type Request, type Response } from 'express';
import { requireMember } from '../auth.js';

export const employeesRouter = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */
const COLS = 'id, name, email, phone, title, department, linkedin, source, notes, status, last_interview_id, last_interviewed_at, created_at, updated_at';

const clean = (v: any): string | null => { const s = v == null ? '' : String(v).trim(); return s || null; };

function mapEmp(r: any) {
  return {
    id: r.id, name: r.name, email: r.email, phone: r.phone, title: r.title,
    department: r.department, linkedin: r.linkedin, source: r.source, notes: r.notes,
    status: r.status, lastInterviewId: r.last_interview_id, lastInterviewedAt: r.last_interviewed_at,
    updatedAt: r.updated_at,
  };
}

employeesRouter.get('/orgs/:orgId/employees', requireMember(), async (req: Request, res: Response) => {
  const { data, error } = await req.db!.from('employees').select(COLS).eq('org_id', req.params.orgId).order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ employees: ((data ?? []) as any[]).map(mapEmp) });
});

employeesRouter.post('/orgs/:orgId/employees', requireMember(), async (req: Request, res: Response) => {
  const b = req.body || {};
  const name = (b.name || '').toString().trim();
  if (!name) { res.status(400).json({ error: 'A name is required.' }); return; }
  const row = {
    org_id: req.params.orgId, name,
    email: clean(b.email), phone: clean(b.phone), title: clean(b.title),
    department: clean(b.department), linkedin: clean(b.linkedin),
    source: ['manual', 'csv', 'linkedin', 'clay', 'lusha', 'hris'].includes(b.source) ? b.source : 'manual',
    notes: clean(b.notes),
  };
  const { data, error } = await req.db!.from('employees').insert(row).select(COLS).single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(mapEmp(data));
});

// Bulk import (CSV / enrichment). Each row needs at least a name.
employeesRouter.post('/orgs/:orgId/employees/import', requireMember(), async (req: Request, res: Response) => {
  const list = Array.isArray(req.body?.employees) ? req.body.employees : [];
  const src = ['manual', 'csv', 'linkedin', 'clay', 'lusha', 'hris'].includes(req.body?.source) ? req.body.source : 'csv';
  const rows = (list as any[])
    .map((e) => ({
      org_id: req.params.orgId, name: (e.name || '').toString().trim(),
      email: clean(e.email), phone: clean(e.phone), title: clean(e.title),
      department: clean(e.department), linkedin: clean(e.linkedin), source: src,
    }))
    .filter((r) => r.name)
    .slice(0, 2000);
  if (!rows.length) { res.status(400).json({ error: 'No valid rows — each employee needs a name.' }); return; }
  const { data, error } = await req.db!.from('employees').insert(rows).select(COLS);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ imported: (data ?? []).length, employees: ((data ?? []) as any[]).map(mapEmp) });
});

// --- enrichment: "Fetch from LinkedIn" via a people-data provider --------------
const ENRICH_PROVIDER = (process.env.ENRICH_PROVIDER || 'apollo').toLowerCase();
const ENRICH_KEY = process.env.ENRICH_API_KEY || '';

interface Candidate { name: string; title: string | null; department: string | null; email: string | null; phone: string | null; linkedin: string | null }

// Apollo.io people search by company domain (returns LinkedIn URL + title; email/
// phone depend on the account's plan/credits).
async function fetchApollo(domain: string, company: string): Promise<Candidate[]> {
  const body: any = { page: 1, per_page: 25 };
  if (domain) body.q_organization_domains = domain; else body.q_organization_name = company;
  const r = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': ENRICH_KEY },
    body: JSON.stringify(body),
  });
  const raw = await r.text(); let d: any = {}; try { d = JSON.parse(raw); } catch { /* */ }
  if (!r.ok) throw new Error(`Apollo ${r.status}: ${d?.error || d?.message || raw.slice(0, 200)}`);
  const people = d.people || d.contacts || [];
  return (people as any[]).map((p) => ({
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
    title: p.title || null,
    department: Array.isArray(p.departments) ? p.departments[0] : (p.department || null),
    email: p.email && p.email !== 'email_not_unlocked@domain.com' ? p.email : null,
    phone: p.phone_numbers?.[0]?.raw_number || p.organization?.phone || null,
    linkedin: p.linkedin_url || null,
  })).filter((c) => c.name);
}

// Proxycurl — LinkedIn-native: resolve domain → company, then list employees.
async function fetchProxycurl(domain: string, company: string): Promise<Candidate[]> {
  const auth = { Authorization: `Bearer ${ENRICH_KEY}` };
  let companyUrl = '';
  if (domain) {
    const rr = await fetch(`https://nubela.co/proxycurl/api/linkedin/company/resolve/?company_domain=${encodeURIComponent(domain)}`, { headers: auth });
    const rd: any = await rr.json().catch(() => ({}));
    if (!rr.ok) throw new Error(`Proxycurl resolve ${rr.status}: ${rd?.description || ''}`);
    companyUrl = rd.url || '';
  }
  if (!companyUrl && company) {
    const rr = await fetch(`https://nubela.co/proxycurl/api/linkedin/company/resolve/?company_name=${encodeURIComponent(company)}`, { headers: auth });
    const rd: any = await rr.json().catch(() => ({}));
    companyUrl = rd.url || '';
  }
  if (!companyUrl) throw new Error('Could not resolve the company on LinkedIn.');
  const er = await fetch(`https://nubela.co/proxycurl/api/linkedin/company/employees/?url=${encodeURIComponent(companyUrl)}&page_size=25&employment_status=current`, { headers: auth });
  const ed: any = await er.json().catch(() => ({}));
  if (!er.ok) throw new Error(`Proxycurl employees ${er.status}: ${ed?.description || ''}`);
  return ((ed.employees || []) as any[]).map((e) => {
    const p = e.profile || {};
    return {
      name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
      title: p.occupation || p.headline || null,
      department: null, email: null, phone: null,
      linkedin: e.profile_url || null,
    };
  }).filter((c) => c.name);
}

// POST /employees/fetch { domain?, company? } -> { candidates } (review before import)
employeesRouter.post('/orgs/:orgId/employees/fetch', requireMember(), async (req: Request, res: Response) => {
  if (!ENRICH_KEY) {
    res.status(503).json({ error: 'Enrichment is not configured. Set ENRICH_PROVIDER (apollo | proxycurl) and ENRICH_API_KEY in server/.env.' });
    return;
  }
  const domain = (req.body?.domain || '').toString().trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const company = (req.body?.company || '').toString().trim();
  if (!domain && !company) { res.status(400).json({ error: 'Enter a company domain (e.g. cannarabiotech.com) or name.' }); return; }
  try {
    const candidates = ENRICH_PROVIDER === 'proxycurl' ? await fetchProxycurl(domain, company) : await fetchApollo(domain, company);
    res.json({ candidates, provider: ENRICH_PROVIDER });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Fetch failed.' });
  }
});

employeesRouter.patch('/orgs/:orgId/employees/:id', requireMember(), async (req: Request, res: Response) => {
  const b = req.body || {};
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ['name', 'email', 'phone', 'title', 'department', 'linkedin', 'notes']) if (f in b) set[f] = clean(b[f]);
  if (typeof b.status === 'string' && ['pending', 'dispatched', 'interviewed'].includes(b.status)) set.status = b.status;
  const { data, error } = await req.db!.from('employees').update(set)
    .eq('org_id', req.params.orgId).eq('id', req.params.id).select(COLS).maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: 'Employee not found.' }); return; }
  res.json(mapEmp(data));
});

employeesRouter.delete('/orgs/:orgId/employees/:id', requireMember(), async (req: Request, res: Response) => {
  const { error } = await req.db!.from('employees').delete().eq('org_id', req.params.orgId).eq('id', req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).end();
});
/* eslint-enable @typescript-eslint/no-explicit-any */
