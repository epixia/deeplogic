// Admin → Cannara Demo. A live-feeling cultivation + sales dashboard reading the
// demo dataset straight from Supabase (PostgREST + publishable key; RLS allows
// read). Auto-refreshes so cron-driven changes appear live.

import { useCallback, useEffect, useState } from 'react'
import './admin.css'

// Demo Supabase (publishable key is anon-safe; the data is RLS read-only).
const SB_URL = 'https://gfuxnyjeouyomdsdkqve.supabase.co'
const SB_KEY = 'sb_publishable_ez6OsIfauoLGtgBJj2Gm_A_Kmep2HYR'

async function sb<T = Record<string, unknown>>(path: string): Promise<T[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
  if (!r.ok) throw new Error(`Supabase ${r.status} — ${(await r.text()).slice(0, 120)}`)
  return r.json() as Promise<T[]>
}

interface Room { id: number; name: string; facility: string; room_type: string; strain: string | null; plant_count: number; target_temp_c: number; target_humidity_pct: number }
interface Reading { room_id: number; recorded_at: string; temp_c: number; humidity_pct: number; co2_ppm: number; vpd_kpa: number }
interface Sale { occurred_at: string; total_cad: number; channel: string; units: number }
interface Harvest { room_id: number; strain: string; harvest_date: string; dry_weight_g: number; grade: string }

const cad = (n: number) => '$' + Math.round(n).toLocaleString()
const dayKey = (iso: string) => iso.slice(0, 10)

export default function AdminCannaraDemo() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [latest, setLatest] = useState<Record<number, Reading>>({})
  const [sales, setSales] = useState<Sale[]>([])
  const [harvests, setHarvests] = useState<Harvest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string>('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const [rms, reads, sls, hvs] = await Promise.all([
        sb<Room>('cnra_rooms?select=*&order=id'),
        sb<Reading>('cnra_room_sensor_readings?select=room_id,recorded_at,temp_c,humidity_pct,co2_ppm,vpd_kpa&order=recorded_at.desc&limit=120'),
        sb<Sale>('cnra_sales?select=occurred_at,total_cad,channel,units&order=occurred_at.desc&limit=4000'),
        sb<Harvest>('cnra_harvests?select=room_id,strain,harvest_date,dry_weight_g,grade&order=harvest_date.desc&limit=8'),
      ])
      const lat: Record<number, Reading> = {}
      for (const r of reads) if (!(r.room_id in lat)) lat[r.room_id] = r
      setRooms(rms); setLatest(lat); setSales(sls); setHarvests(hvs)
      setUpdatedAt(new Date().toLocaleTimeString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load demo data. Run seed_cannara_demo.sql in Supabase first.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load(); const id = setInterval(() => void load(), 30_000); return () => clearInterval(id) }, [load])

  // ---- derived ----
  const totalPlants = rooms.reduce((s, r) => s + (r.plant_count || 0), 0)
  const now = Date.now()
  const since = (days: number) => now - days * 86400_000
  const rev30 = sales.filter((s) => new Date(s.occurred_at).getTime() >= since(30)).reduce((s, x) => s + Number(x.total_cad), 0)
  const todayKey = new Date().toISOString().slice(0, 10)
  const revToday = sales.filter((s) => dayKey(s.occurred_at) === todayKey).reduce((s, x) => s + Number(x.total_cad), 0)
  const unitsToday = sales.filter((s) => dayKey(s.occurred_at) === todayKey).reduce((s, x) => s + x.units, 0)

  // daily revenue series (last 30 days)
  const byDay = new Map<string, number>()
  for (const s of sales) {
    const k = dayKey(s.occurred_at)
    if (new Date(k).getTime() >= since(30)) byDay.set(k, (byDay.get(k) ?? 0) + Number(s.total_cad))
  }
  const series = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const maxDay = Math.max(1, ...series.map((d) => d[1]))

  // channel breakdown (last 30 days)
  const byChannel = new Map<string, number>()
  for (const s of sales) {
    if (new Date(s.occurred_at).getTime() >= since(30)) byChannel.set(s.channel, (byChannel.get(s.channel) ?? 0) + Number(s.total_cad))
  }
  const channels = [...byChannel.entries()].sort((a, b) => b[1] - a[1])
  const maxCh = Math.max(1, ...channels.map((c) => c[1]))

  // sensor status color vs each room's target
  const tempCls = (r: Room) => {
    const rd = latest[r.id]
    if (!rd) return 'cd-na'
    const d = Math.abs(rd.temp_c - r.target_temp_c)
    return d <= 1.5 ? 'cd-ok' : d <= 3 ? 'cd-warn' : 'cd-crit'
  }
  const sensorRooms = rooms.filter((r) => latest[r.id])

  return (
    <div className="cd-standalone">
      <div className="cd">
        <div className="cd-head">
          <div>
            <h1 className="cd-h1">🌿 Cannara — Live Operations</h1>
            <p className="cd-sub">Demo cultivation &amp; sales dashboard · {sensorRooms.length} monitored rooms · updated {updatedAt || '—'}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>↻ Refresh</button>
        </div>

        {error && <div className="bb-error">{error}</div>}
        {loading ? <p className="cd-sub">Loading live data…</p> : (
          <>
            {/* KPI row */}
            <div className="cd-kpis">
              <div className="cd-kpi"><div className="cd-kpi-v">{cad(revToday)}</div><div className="cd-kpi-l">Revenue today</div></div>
              <div className="cd-kpi"><div className="cd-kpi-v">{cad(rev30)}</div><div className="cd-kpi-l">Revenue · 30 days</div></div>
              <div className="cd-kpi"><div className="cd-kpi-v">{unitsToday.toLocaleString()}</div><div className="cd-kpi-l">Units sold today</div></div>
              <div className="cd-kpi"><div className="cd-kpi-v">{totalPlants.toLocaleString()}</div><div className="cd-kpi-l">Plants in canopy</div></div>
              <div className="cd-kpi"><div className="cd-kpi-v">{rooms.length}</div><div className="cd-kpi-l">Active rooms</div></div>
            </div>

            {/* Room sensors */}
            <section className="cd-card">
              <h2>Grow rooms — live climate</h2>
              <div className="cd-rooms">
                {sensorRooms.map((r) => {
                  const rd = latest[r.id]
                  return (
                    <div key={r.id} className={`cd-room ${tempCls(r)}`}>
                      <div className="cd-room-top"><span className="cd-room-name">{r.name}</span><span className="cd-room-fac">{r.facility}</span></div>
                      <div className="cd-room-temp">{rd.temp_c.toFixed(1)}°C</div>
                      <div className="cd-room-meta">target {r.target_temp_c}°C · 💧 {rd.humidity_pct.toFixed(0)}% · CO₂ {rd.co2_ppm}</div>
                      {r.strain && r.strain !== 'Mixed' && r.strain !== 'Propagation' && r.strain !== 'Genetics Library' && <div className="cd-room-strain">{r.strain} · {r.plant_count.toLocaleString()} plants</div>}
                    </div>
                  )
                })}
              </div>
            </section>

            <div className="cd-2col">
              {/* Sales trend */}
              <section className="cd-card">
                <h2>Net sales — last 30 days</h2>
                <div className="cd-bars">
                  {series.map(([d, v]) => (
                    <div key={d} className="cd-bar" title={`${d}: ${cad(v)}`}>
                      <div className="cd-bar-fill" style={{ height: `${Math.max(3, (v / maxDay) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="cd-sub">Peak day {cad(maxDay)}</div>
              </section>

              {/* Channel breakdown */}
              <section className="cd-card">
                <h2>Revenue by channel · 30 days</h2>
                <div className="cd-channels">
                  {channels.map(([c, v]) => (
                    <div key={c} className="cd-ch">
                      <div className="cd-ch-row"><span>{c}</span><span>{cad(v)}</span></div>
                      <div className="cd-ch-track"><div className="cd-ch-fill" style={{ width: `${(v / maxCh) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Harvests */}
            <section className="cd-card">
              <h2>Recent harvests</h2>
              <table className="bb-table">
                <thead><tr><th>Date</th><th>Room</th><th>Strain</th><th>Dry yield</th><th>Grade</th></tr></thead>
                <tbody>
                  {harvests.map((h, i) => (
                    <tr key={i}>
                      <td>{h.harvest_date}</td>
                      <td>{rooms.find((r) => r.id === h.room_id)?.name ?? `Room ${h.room_id}`}</td>
                      <td>{h.strain}</td>
                      <td>{(h.dry_weight_g / 1000).toFixed(1)} kg</td>
                      <td>{h.grade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
