// HeroOrchestration — the logged-out homepage value-prop animation.
//
// The central triangle is the company-intelligence "brain" (orchestrator, full
// of connectors + data). Every few seconds it spins +120° — and because an
// equilateral triangle has 3-fold symmetry it lands looking identical, reading
// as "a new mission." With each turn the orchestrator DEPLOYS a fresh team of
// 3 agents (out to the triangle's extremities) to run that mission.

import { useEffect, useState, type CSSProperties } from 'react'
import './hero-orchestration.css'

const CX = 260
const CY = 224 // a touch lower so the brain reads as centered
const RT = 140

// Equilateral triangle (apex up), centroid = (CX, CY).
const A = { x: CX, y: CY - RT }                                   // top
const B = { x: CX + RT * Math.cos(Math.PI / 6), y: CY + RT / 2 } // bottom-right
const D = { x: CX - RT * Math.cos(Math.PI / 6), y: CY + RT / 2 } // bottom-left
const lerp = (p: { x: number; y: number }, t: number) => ({ x: p.x + (CX - p.x) * t, y: p.y + (CY - p.y) * t })
const iA = lerp(A, 0.45), iB = lerp(B, 0.45), iD = lerp(D, 0.45)

// Agent deploy slots at the three extremities (label offset ly) + the triangle
// vertex each connects to (so the spoke sits outside the brain, fully visible).
const SLOTS = [
  { x: CX, y: 38, ly: -40, from: A },  // top
  { x: 90, y: 322, ly: 42, from: D },  // bottom-left
  { x: 430, y: 322, ly: 42, from: B }, // bottom-right
]

const DATA = [
  { x: 252, y: 224 }, { x: 270, y: 218 }, { x: 260, y: 239 },
  { x: 244, y: 233 }, { x: 274, y: 235 }, { x: 256, y: 211 },
]

interface Mission { name: string; agents: { icon: string; label: string }[] }
const MISSIONS: Mission[] = [
  { name: 'Sales', agents: [{ icon: '🎯', label: 'Lead Gen' }, { icon: '📈', label: 'Pipeline' }, { icon: '🔮', label: 'Forecast' }] },
  { name: 'Efficiency', agents: [{ icon: '💰', label: 'Cost Watch' }, { icon: '⚙', label: 'Ops Monitor' }, { icon: '🤖', label: 'Automation' }] },
  { name: 'Competitor', agents: [{ icon: '🔎', label: 'Recon' }, { icon: '🏷', label: 'Pricing' }, { icon: '⚔', label: 'Positioning' }] },
]

export default function HeroOrchestration() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => s + 1), 4800)
    return () => clearInterval(t)
  }, [])

  const rotation = step * 120 // always spins forward
  const mission = MISSIONS[step % MISSIONS.length]

  return (
    <div className="ho" role="img" aria-label={`DeepLogic orchestrator running the ${mission.name} mission with three deployed agents`}>
      <svg viewBox="0 0 520 430" className="ho-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Follows the active brand accent (Settings → Appearance → Branding). */}
          <linearGradient id="ho-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--cyan, #7ff0fb)" />
            <stop offset="0.5" stopColor="var(--blue, #49a0e6)" />
            <stop offset="1" stopColor="var(--blue, #5560e8)" />
          </linearGradient>
          <filter id="ho-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* spokes — goals/data flowing from each extremity out to its agent */}
        {SLOTS.map((s, k) => (
          <line key={`l${k}`} className="ho-spoke" x1={s.from.x} y1={s.from.y} x2={s.x} y2={s.y} style={{ animationDelay: `${k * 0.3}s` }} />
        ))}

        {/* brain halo (pulses, does not rotate) */}
        <circle className="ho-halo" cx={CX} cy={CY} r={84} />

        {/* spinning brain — each +120° turn = a new mission; data swirls inside it */}
        <g className="ho-spin" style={{ transform: `rotate(${rotation}deg)`, transformBox: 'view-box', transformOrigin: `${CX}px ${CY}px` }}>
          <g className="ho-brain" filter="url(#ho-glow)">
            <polygon className="ho-tri" points={`${A.x},${A.y} ${B.x},${B.y} ${D.x},${D.y}`} />
            <polygon className="ho-tri ho-tri--inner" points={`${iA.x},${iA.y} ${iB.x},${iB.y} ${iD.x},${iD.y}`} />
            <circle className="ho-vtx" cx={A.x} cy={A.y} r="8" />
            <circle className="ho-vtx" cx={B.x} cy={B.y} r="8" />
            <circle className="ho-vtx" cx={D.x} cy={D.y} r="8" />
          </g>
          {DATA.map((d, i) => (
            <circle key={`d${i}`} className="ho-data" cx={d.x} cy={d.y} r="2.6" style={{ animationDelay: `${i * 0.4}s` }} />
          ))}
        </g>

        {/* deployed agents — flung out from the centre by the spin's centrifugal force */}
        {SLOTS.map((s, k) => {
          const ag = mission.agents[k]
          const dx = CX - s.x // start offset = the brain centre (relative to this slot)
          const dy = CY - s.y
          return (
            <g key={`${step}-${k}`} transform={`translate(${s.x} ${s.y})`}>
              <g
                className="ho-agent"
                style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, animationDelay: `${k * 0.07}s` } as CSSProperties}
              >
                <circle className="ho-agent-ring" cx={0} cy={0} r="26" />
                <text className="ho-agent-ic" x={0} y={0} textAnchor="middle" dominantBaseline="central">{ag.icon}</text>
                <text className="ho-agent-label" x={0} y={s.ly} textAnchor="middle">{ag.label}</text>
              </g>
            </g>
          )
        })}
      </svg>

      <div className="ho-caption">
        <span className="ho-caption-k">Running mission</span>
        <span key={step} className="ho-caption-v">{mission.name}</span>
      </div>
    </div>
  )
}
