#!/usr/bin/env node
// DeepLogic self-hosted agent worker.
//
// Run this on YOUR machine (e.g. a Mac mini) to power a "Self-hosted" Hermes /
// OpenClaw agent. It polls DeepLogic for the agent's mission, runs your local
// command, and streams progress + the final result back. Nothing inbound is
// exposed — the worker only makes outbound HTTPS calls.
//
// Requires Node 18+ (global fetch). No dependencies.
//
// Usage (values shown on the agent's "🔌 Connect your worker" panel):
//   DEEPLOGIC_URL=https://app.deeplogic... \
//   AGENT_ID=<uuid> \
//   AGENT_TOKEN=<token> \
//   HERMES_CMD='your-hermes "{{mission}}"' \
//   node scripts/hermes-worker.mjs
//
// HERMES_CMD is your runtime command; "{{mission}}" is replaced with the mission
// text. Its stdout becomes the agent's result. If HERMES_CMD is omitted, the
// worker just echoes the mission (handy for testing the round-trip).

import { spawn } from 'node:child_process'

const BASE = (process.env.DEEPLOGIC_URL || '').replace(/\/+$/, '')
const AGENT_ID = process.env.AGENT_ID || ''
const TOKEN = process.env.AGENT_TOKEN || ''
const CMD = process.env.HERMES_CMD || ''
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 5000)

if (!BASE || !AGENT_ID || !TOKEN) {
  console.error('Set DEEPLOGIC_URL, AGENT_ID and AGENT_TOKEN. See the agent\'s Connect panel.')
  process.exit(1)
}

const headers = { 'Content-Type': 'application/json', 'x-agent-token': TOKEN }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function poll() {
  const r = await fetch(`${BASE}/api/agent-poll/${AGENT_ID}`, { method: 'POST', headers })
  if (!r.ok) throw new Error(`poll ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json() // { status: 'assigned'|'in_progress'|'idle', mission }
}

async function report(body) {
  await fetch(`${BASE}/api/agent-callback/${AGENT_ID}`, { method: 'POST', headers, body: JSON.stringify(body) })
    .catch((e) => console.error('report failed:', e.message))
}

// Run the local command, streaming stdout lines back as progress. Returns stdout.
function runMission(mission) {
  return new Promise((resolve, reject) => {
    if (!CMD) { resolve(`(no HERMES_CMD set) Echoing mission:\n${mission}`); return }
    const full = CMD.replaceAll('{{mission}}', mission)
    const child = spawn(full, { shell: true })
    let out = ''
    child.stdout.on('data', (d) => {
      const s = d.toString(); out += s
      const line = s.trim().split('\n').pop()
      if (line) void report({ status: 'in_progress', message: line.slice(0, 500) })
    })
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`command exited ${code}`))))
  })
}

async function main() {
  console.log(`DeepLogic worker for agent ${AGENT_ID} — polling ${BASE} every ${POLL_MS}ms`)
  for (;;) {
    try {
      const job = await poll()
      if (job.status === 'assigned' && job.mission) {
        console.log('Mission claimed:', job.mission.slice(0, 120))
        await report({ status: 'in_progress', message: 'Worker started the mission.' })
        try {
          const result = await runMission(job.mission)
          await report({ status: 'completed', message: 'Mission complete.', result })
          console.log('Reported completion.')
        } catch (e) {
          await report({ status: 'failed', message: String(e.message || e).slice(0, 500) })
          console.error('Mission failed:', e.message)
        }
      }
    } catch (e) {
      console.error('poll error:', e.message)
    }
    await sleep(POLL_MS)
  }
}

void main()
