// Employees roster — the company's people. Import from CSV / add manually, then
// multi-select and "Dispatch interviews" to fire mass AI mind-dump calls (Vapi),
// whose transcripts land back in the Data Vault attributed to each person.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import {
  listEmployees, createEmployee, importEmployees, updateEmployee, deleteEmployee,
  fetchEmployees, startPhoneInterview, type Employee, type EmployeeCandidate,
} from '../../lib/api'
import './employees.css'

// --- minimal CSV parsing with header aliases ---
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}
const ALIASES: Record<string, keyof Employee> = {
  name: 'name', 'full name': 'name', fullname: 'name',
  email: 'email', 'email address': 'email', 'work email': 'email',
  phone: 'phone', 'phone number': 'phone', mobile: 'phone', cell: 'phone', telephone: 'phone',
  title: 'title', 'job title': 'title', position: 'title', role: 'title',
  department: 'department', dept: 'department', team: 'department',
  linkedin: 'linkedin', 'linkedin url': 'linkedin', profile: 'linkedin',
}
function parseCsv(text: string): Partial<Employee>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const first = headers.findIndex((h) => h === 'first name' || h === 'firstname')
  const last = headers.findIndex((h) => h === 'last name' || h === 'lastname')
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const e: Partial<Employee> = {}
    headers.forEach((h, i) => { const k = ALIASES[h]; if (k) (e as Record<string, unknown>)[k] = cells[i]?.trim() || undefined })
    if (!e.name && first >= 0) e.name = [cells[first], cells[last]].filter(Boolean).join(' ').trim()
    return e
  }).filter((e) => e.name)
}

export default function Employees({ orgId }: { orgId: string }) {
  const { getAccessToken } = useAuth()
  const token = useCallback(async () => {
    const t = await getAccessToken()
    if (!t) throw new Error('Session expired')
    return t
  }, [getAccessToken])

  const [emps, setEmps] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [topic, setTopic] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // add form
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Partial<Employee>>({})
  // import
  const [showImport, setShowImport] = useState(false)
  const [csv, setCsv] = useState('')
  // fetch (enrichment)
  const [showFetch, setShowFetch] = useState(false)
  const [fetchQ, setFetchQ] = useState('')
  const [fetching, setFetching] = useState(false)
  const [cands, setCands] = useState<EmployeeCandidate[] | null>(null)
  const [candSel, setCandSel] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try { setEmps((await listEmployees(await token(), orgId)).employees) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load employees.') }
    finally { setLoading(false) }
  }, [token, orgId])
  useEffect(() => { void load() }, [load])

  const allSel = emps.length > 0 && emps.every((e) => sel.has(e.id))
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel((s) => s.size === emps.length ? new Set() : new Set(emps.map((e) => e.id)))
  const selected = useMemo(() => emps.filter((e) => sel.has(e.id)), [emps, sel])
  const withPhone = selected.filter((e) => e.phone?.trim())

  async function add() {
    if (!form.name?.trim()) { setError('Name is required.'); return }
    try { await createEmployee(await token(), orgId, { ...form, source: 'manual' }); setForm({}); setShowAdd(false); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add.') }
  }
  async function doImport() {
    const rows = parseCsv(csv)
    if (!rows.length) { setError('No rows found — paste CSV with a header row (name, email, phone, title…).'); return }
    try { const r = await importEmployees(await token(), orgId, rows); setCsv(''); setShowImport(false); setNote(`Imported ${r.imported} employees.`); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Import failed.') }
  }
  async function doFetch() {
    const q = fetchQ.trim()
    if (!q) { setError('Enter a company domain (e.g. cannarabiotech.com) or name.'); return }
    setFetching(true); setError(null); setCands(null); setCandSel(new Set())
    try {
      const isDomain = /\.[a-z]{2,}$/i.test(q) && !/\s/.test(q)
      const r = await fetchEmployees(await token(), orgId, isDomain ? { domain: q } : { company: q })
      setCands(r.candidates)
      setCandSel(new Set(r.candidates.map((_, i) => i))) // pre-select all
      if (r.candidates.length === 0) setNote('No public profiles found for that company.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Fetch failed.') }
    finally { setFetching(false) }
  }
  async function importCands() {
    const picked = (cands ?? []).filter((_, i) => candSel.has(i))
    if (!picked.length) { setError('Select at least one person to import.'); return }
    try {
      const r = await importEmployees(await token(), orgId, picked, 'linkedin')
      setNote(`Imported ${r.imported} people from LinkedIn.`); setShowFetch(false); setCands(null); setFetchQ('')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.') }
  }

  async function remove(e: Employee) {
    if (!confirm(`Remove ${e.name}?`)) return
    try { await deleteEmployee(await token(), orgId, e.id); setSel((s) => { const n = new Set(s); n.delete(e.id); return n }); setEmps((p) => p.filter((x) => x.id !== e.id)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not remove.') }
  }

  async function dispatch() {
    if (withPhone.length === 0) { setError('Select employees that have a phone number.'); return }
    if (!confirm(`Dispatch AI interviews to ${withPhone.length} employee(s) by phone now?`)) return
    setDispatching(true); setError(null); setNote(null)
    let ok = 0; const fails: string[] = []
    const t = await token()
    for (const e of withPhone) {
      try {
        await startPhoneInterview(t, orgId, { phoneNumber: e.phone!.trim(), interviewee: e.name, role: e.title ?? '', topic })
        await updateEmployee(t, orgId, e.id, { status: 'dispatched' }).catch(() => {})
        ok++
      } catch (err) { fails.push(`${e.name}: ${err instanceof Error ? err.message : 'failed'}`) }
    }
    const skipped = selected.length - withPhone.length
    setNote(`Dispatched ${ok}/${withPhone.length} call(s)${skipped ? ` · ${skipped} skipped (no phone)` : ''}${fails.length ? ` · ${fails.length} failed` : ''}.`)
    if (fails.length) setError(fails.slice(0, 3).join(' · '))
    setSel(new Set())
    setDispatching(false)
    await load()
  }

  return (
    <section className="vault-section emp">
      <div className="vault-section-head">
        <h2>Employees</h2>
        <span className="vault-count">{emps.length}</span>
        <div className="emp-head-actions">
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setShowFetch(true); setShowImport(false); setShowAdd(false) }}>🔎 Fetch (LinkedIn)</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setShowImport(true); setShowFetch(false); setShowAdd(false) }}>⤓ Import CSV</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setShowAdd(true); setShowFetch(false); setShowImport(false) }}>+ Add</button>
        </div>
      </div>

      {error && <div className="vault-error">{error}</div>}
      {note && <div className="emp-note">{note}</div>}

      {showAdd && (
        <div className="emp-form">
          <input placeholder="Full name *" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input placeholder="Phone (+1…)" value={form.phone ?? ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <input placeholder="Title" value={form.title ?? ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <input placeholder="Department" value={form.department ?? ''} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
          <input placeholder="Email" value={form.email ?? ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <div className="emp-form-actions">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setShowAdd(false); setForm({}) }}>Cancel</button>
            <button type="button" className="btn btn-primary btn-xs" onClick={() => void add()}>Add employee</button>
          </div>
        </div>
      )}
      {showFetch && (
        <div className="emp-import">
          <p className="emp-import-hint">Pull a company's people from public LinkedIn data via your configured provider (Apollo / Proxycurl). Enter the company <strong>domain</strong> (best) or name. Review the results, then import the ones you want.</p>
          <div className="emp-fetch-row">
            <input placeholder="cannarabiotech.com" value={fetchQ} onChange={(e) => setFetchQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doFetch() }} />
            <button type="button" className="btn btn-primary btn-xs" onClick={() => void doFetch()} disabled={fetching || !fetchQ.trim()}>
              {fetching ? 'Fetching…' : '🔎 Fetch'}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setShowFetch(false); setCands(null); setFetchQ('') }}>Cancel</button>
          </div>
          {cands && cands.length > 0 && (
            <div className="emp-cands">
              <div className="emp-cands-head">
                <label><input type="checkbox" className="vault-check" checked={candSel.size === cands.length}
                  onChange={() => setCandSel((s) => s.size === cands.length ? new Set() : new Set(cands.map((_, i) => i)))} /> {candSel.size} of {cands.length} selected</label>
                <button type="button" className="btn btn-primary btn-xs" onClick={() => void importCands()} disabled={candSel.size === 0}>Import selected ({candSel.size})</button>
              </div>
              <div className="emp-cands-list">
                {cands.map((c, i) => (
                  <label key={i} className={`emp-cand${candSel.has(i) ? ' is-on' : ''}`}>
                    <input type="checkbox" className="vault-check" checked={candSel.has(i)}
                      onChange={() => setCandSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })} />
                    <span className="emp-cand-main"><span className="emp-name">{c.name}</span>{c.title && <span className="emp-sub">{c.title}</span>}</span>
                    {c.linkedin && <a className="emp-cand-li" href={c.linkedin} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>in↗</a>}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {showImport && (
        <div className="emp-import">
          <p className="emp-import-hint">Paste a CSV (with a header row). Recognised columns: <code>name</code> (or first/last name), <code>email</code>, <code>phone</code>, <code>title</code>, <code>department</code>, <code>linkedin</code>. Works with LinkedIn / HRIS / Clay / Lusha exports.</p>
          <textarea rows={6} placeholder={'name,email,phone,title,department\nJane Doe,jane@co.com,+14155551234,Head of Ops,Operations'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="emp-form-actions">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setShowImport(false); setCsv('') }}>Cancel</button>
            <button type="button" className="btn btn-primary btn-xs" onClick={() => void doImport()} disabled={!csv.trim()}>Import</button>
          </div>
        </div>
      )}

      {/* dispatch bar */}
      {sel.size > 0 && (
        <div className="emp-dispatch">
          <span className="emp-dispatch-count">{sel.size} selected{withPhone.length !== sel.size ? ` · ${withPhone.length} with phone` : ''}</span>
          <input className="emp-topic" placeholder="Optional focus topic for these interviews…" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSel(new Set())}>Clear</button>
          <button type="button" className="btn btn-primary btn-xs" disabled={dispatching || withPhone.length === 0} onClick={() => void dispatch()}>
            {dispatching ? 'Dispatching…' : `📞 Dispatch interviews (${withPhone.length})`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="vault-empty">Loading…</div>
      ) : emps.length === 0 ? (
        <div className="vault-empty">No employees yet — <strong>Import CSV</strong> or <strong>Add</strong> people, then select them to dispatch AI mind-dump interviews.</div>
      ) : (
        <table className="vault-table emp-table">
          <thead>
            <tr>
              <th className="vault-th-sel"><input type="checkbox" className="vault-check" checked={allSel}
                ref={(el) => { if (el) el.indeterminate = sel.size > 0 && !allSel }} onChange={toggleAll} aria-label="Select all" /></th>
              <th>Name</th><th>Title</th><th>Department</th><th>Phone</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {emps.map((e) => (
              <tr key={e.id} className={`vault-trow${sel.has(e.id) ? ' vault-trow--sel' : ''}`}>
                <td className="vault-td-sel"><input type="checkbox" className="vault-check" checked={sel.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.name}`} /></td>
                <td><div className="emp-name">{e.name}</div>{e.email && <div className="emp-sub">{e.email}</div>}</td>
                <td>{e.title ?? '—'}</td>
                <td>{e.department ?? '—'}</td>
                <td>{e.phone ? <span className="emp-phone">{e.phone}</span> : <span className="emp-nophone">no phone</span>}</td>
                <td><span className={`emp-status emp-status--${e.status}`}>{e.status}</span></td>
                <td><button type="button" className="vault-del-btn" title="Remove" onClick={() => void remove(e)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
