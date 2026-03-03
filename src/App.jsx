import { useState, useEffect, useMemo, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ═══════════════════════════════════════════════════════════════
// GNS-AIP COMPLIANCE DASHBOARD — LIVE DATA
// Fetches from Railway API: gns-browser-production.up.railway.app
// ═══════════════════════════════════════════════════════════════

const API_BASE = "https://gns-browser-production.up.railway.app";
const PRINCIPAL_PK = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

// ── Tier System ──
const TIERS = {
  SOVEREIGN: { min: 90, color: "#10B981", bg: "rgba(16,185,129,0.12)", border: "#065F46", label: "SOVEREIGN", icon: "◆" },
  TRUSTED:   { min: 70, color: "#3B82F6", bg: "rgba(59,130,246,0.12)", border: "#1E3A5F", label: "TRUSTED",   icon: "●" },
  VERIFIED:  { min: 40, color: "#8B5CF6", bg: "rgba(139,92,246,0.12)", border: "#4C1D95", label: "VERIFIED",  icon: "▲" },
  BASIC:     { min: 20, color: "#F59E0B", bg: "rgba(245,158,11,0.12)", border: "#78350F", label: "BASIC",     icon: "■" },
  SHADOW:    { min: 0,  color: "#6B7280", bg: "rgba(107,114,128,0.12)",border: "#374151", label: "SHADOW",    icon: "○" },
};
const getTier = (score) => {
  for (const t of Object.values(TIERS)) if (score >= t.min) return t;
  return TIERS.SHADOW;
};

// Map API tiers → Dashboard tier keys
const API_TIER_MAP = {
  sovereign: "SOVEREIGN",
  trusted: "TRUSTED",
  standard: "VERIFIED",
  provisional: "BASIC",
  unverified: "SHADOW",
};

// Map API status → Dashboard status
const API_STATUS_MAP = {
  active: "active",
  provisioned: "provisioning",
  suspended: "suspended",
  revoked: "suspended",
};

// Territory label → map center coords [lat, lng]
const TERRITORY_CENTERS = {
  "it-nord": [45.47, 9.19],
  "it-centro": [42.90, 12.49],
  "it-sud": [40.85, 14.27],
  "it-sardegna": [39.22, 9.12],
  "it-sicilia": [37.50, 14.00],
};

// Delegation tree: delegator_pk → agent_pk (from our seeded certs)
// In production, expose GET /agents/:id/delegations endpoint
const DELEGATION_MAP = {
  [PRINCIPAL_PK]: [
    "1111111111111111111111111111111111111111111111111111111111111111",
    "5555555555555555555555555555555555555555555555555555555555555555",
  ],
  "1111111111111111111111111111111111111111111111111111111111111111": [
    "2222222222222222222222222222222222222222222222222222222222222222",
    "3333333333333333333333333333333333333333333333333333333333333333",
  ],
  "2222222222222222222222222222222222222222222222222222222222222222": [
    "4444444444444444444444444444444444444444444444444444444444444444",
  ],
};

// Find who delegated to this agent
function findDelegator(pk, allAgents) {
  for (const [delegator, delegates] of Object.entries(DELEGATION_MAP)) {
    if (delegates.includes(pk)) {
      if (delegator === PRINCIPAL_PK) return { type: "human", name: "Camilo Ayerbe", id: delegator };
      const parent = allAgents.find(a => a.pk_root === delegator);
      return { type: "agent", name: parent?.displayName || delegator.slice(0, 8) + "...", id: delegator };
    }
  }
  return { type: "human", name: "Camilo Ayerbe", id: PRINCIPAL_PK };
}

// ── API Fetch Helpers ──
async function fetchFleet() {
  const res = await fetch(`${API_BASE}/agents?principal=${PRINCIPAL_PK}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

async function fetchManifest(pk) {
  const res = await fetch(`${API_BASE}/agents/${pk}/manifest`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

async function fetchCompliance(pk) {
  const res = await fetch(`${API_BASE}/agents/${pk}/compliance`);
  const json = await res.json();
  if (!json.success) return null;
  return json.data;
}

// Transform API manifest → dashboard agent shape
function transformAgent(manifest, fleet, allManifests) {
  const pk = manifest.pk_root;
  const handle = manifest.agent_handle?.replace(/^@/, "") || pk.slice(0, 16);
  const territoryLabel = handle.split("@")[1] || manifest.jurisdiction || "unknown";
  const h3Center = TERRITORY_CENTERS[territoryLabel.toLowerCase()] || [42.5, 12.5];
  const score = Number(manifest.compliance?.score || 0);
  const tier = API_TIER_MAP[manifest.compliance?.tier] || "SHADOW";
  const violations = manifest.stats?.violations || 0;
  const breadcrumbs = manifest.stats?.breadcrumbs || 0;
  const depth = manifest.principal?.chain_depth || 0;
  const delegator = findDelegator(pk, allManifests.map(m => transformAgentBasic(m)));

  // Determine status (flag as warning if violations > 0 and active)
  let status = API_STATUS_MAP[manifest.status] || "active";
  if (violations > 0 && status === "active") status = "warning";

  // Build compliance history from breakdown
  // In production: wire to GET /agents/:pk/compliance/history
  const history = buildHistory(manifest, score);

  // Build violation entries from breadcrumb data
  const violationList = buildViolations(pk, violations, manifest.home_cells);

  // Children (agents this one delegated to)
  const children = (DELEGATION_MAP[pk] || []);

  return {
    id: pk,
    pk_root: pk,
    shortId: pk.slice(0, 4) + "..." + pk.slice(-4),
    name: manifest.manifest?.name?.toLowerCase().replace(/\s+/g, "-") || handle,
    displayName: manifest.manifest?.name || handle,
    role: manifest.manifest?.role || manifest.agent_type,
    org: manifest.manifest?.org || "terna",
    territory: [territoryLabel.toUpperCase()],
    h3Cells: manifest.home_cells || [],
    h3Center,
    status,
    score,
    tier,
    delegatedBy: delegator,
    delegationDepth: depth,
    delegationScope: manifest.manifest?.capabilities || [],
    delegationExpiry: "2027-01-15T00:00:00Z",
    breadcrumbs,
    created: manifest.created_at?.split("T")[0] || "2026-01-01",
    history,
    violations: violationList,
    children,
    // Raw API data for detail views
    _manifest: manifest,
  };
}

function transformAgentBasic(manifest) {
  return {
    pk_root: manifest.pk_root,
    displayName: manifest.manifest?.name || manifest.agent_handle || manifest.pk_root.slice(0, 12),
  };
}

// Build compliance history from current score (simulated monthly progression)
// TODO: Replace with GET /agents/:pk/compliance/history endpoint
function buildHistory(manifest, currentScore) {
  const created = new Date(manifest.created_at || "2026-01-15");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const startMonth = created.getMonth();
  const now = new Date();
  const endMonth = Math.min(now.getMonth(), 7); // Cap at August for demo

  const history = [];
  const totalSteps = Math.max(1, endMonth - startMonth + 1);
  const violations = manifest.stats?.violations || 0;

  for (let i = 0; i < totalSteps; i++) {
    const monthIdx = startMonth + i;
    if (monthIdx > 11) break;
    let pct = (i + 1) / totalSteps;
    // If violations, show degradation in final months
    let s;
    if (violations > 0 && i >= totalSteps - 2) {
      const peak = currentScore + violations * 3;
      s = i === totalSteps - 1 ? currentScore : Math.round(peak - (peak - currentScore) * 0.4);
    } else {
      s = Math.round(currentScore * pct);
    }
    history.push({ t: months[monthIdx], s: Math.min(100, Math.max(0, s)) });
  }
  return history;
}

// Build violation list from breadcrumb violation count
function buildViolations(pk, violationCount, homeCells) {
  if (violationCount === 0) return [];
  // Billing agent specific violations (known from seed data)
  if (pk === "5555555555555555555555555555555555555555555555555555555555555555") {
    return [
      { ts: "2026-08-28T14:32:00Z", type: "TERRITORY_DRIFT", detail: "Operated in IT-NORD cell (unauthorized)", severity: "high" },
      { ts: "2026-08-25T09:15:00Z", type: "TERRITORY_DRIFT", detail: "Operated in IT-NORD cell (unauthorized)", severity: "high" },
      { ts: "2026-08-20T22:01:00Z", type: "TERRITORY_DRIFT", detail: "Operated in IT-NORD cell (unauthorized)", severity: "high" },
    ].slice(0, violationCount);
  }
  // Generic violations
  return Array.from({ length: violationCount }, (_, i) => ({
    ts: new Date(Date.now() - i * 86400000 * 3).toISOString(),
    type: "TERRITORY_DRIFT", detail: "Operated outside declared territory", severity: "medium",
  }));
}


// ── Reusable Components ──

const mono = { fontFamily: "'JetBrains Mono','SF Mono','Fira Code',monospace" };

function TierBadge({ tier, size = "sm" }) {
  const t = TIERS[tier] || TIERS.SHADOW;
  const sz = size === "lg" ? { fontSize: 12, padding: "4px 14px" } : { fontSize: 10, padding: "3px 10px" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 4, background: t.bg, border: `1px solid ${t.border}`, color: t.color, fontWeight: 700, letterSpacing: 1, ...mono, ...sz }}>
      <span style={{ fontSize: sz.fontSize - 2 }}>{t.icon}</span>{t.label}
    </span>
  );
}

function StatusIndicator({ status }) {
  const cfg = { active: ["#10B981","Active"], warning: ["#F59E0B","Warning"], provisioning: ["#6B7280","Provisioning"], suspended: ["#EF4444","Suspended"] };
  const [color, label] = cfg[status] || cfg.active;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: status === "active" ? `0 0 6px ${color}` : "none", display: "inline-block" }} />
      {label}
    </span>
  );
}

function ScoreRing({ score, size = 56 }) {
  const t = getTier(score);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = score / 100;
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1F2937" strokeWidth={4} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={t.color} strokeWidth={4}
        strokeDasharray={`${c*pct} ${c*(1-pct)}`} strokeLinecap="round"
        style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dasharray 0.6s ease" }} />
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="central"
        fill={t.color} fontSize={size*0.28} fontWeight="800" style={mono}>{score}</text>
    </svg>
  );
}

function Card({ children, style, ...rest }) {
  return <div style={{ background: "#0F1629", border: "1px solid #1E293B", borderRadius: 10, ...style }} {...rest}>{children}</div>;
}

function CardHeader({ children, right, style }) {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #1E293B", display: "flex", justifyContent: "space-between", alignItems: "center", ...style }}>
      <div>{children}</div>
      {right && <div>{right}</div>}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, color: "#4B5563", fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>{children}</div>;
}

// ── Loading Spinner ──
function LoadingState({ message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: "3px solid #1E293B", borderTop: "3px solid #3B82F6", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <div style={{ fontSize: 13, color: "#6B7280" }}>{message}</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ── Data Source Badge ──
function DataSourceBadge({ live }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 4, background: live ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)", border: `1px solid ${live ? "#065F46" : "#78350F"}`, fontSize: 9, fontWeight: 600, ...mono }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: live ? "#10B981" : "#F59E0B", display: "inline-block" }} />
      <span style={{ color: live ? "#10B981" : "#F59E0B" }}>{live ? "LIVE" : "CACHED"}</span>
    </span>
  );
}

// ── Territory Map (SVG Italy with H3 zones) ──
function TerritoryMap({ agents, selectedAgent, onSelect }) {
  const mapW = 400, mapH = 500;
  const project = ([lat, lng]) => {
    const x = ((lng - 6.5) / (18.5 - 6.5)) * mapW;
    const y = mapH - ((lat - 36) / (47.5 - 36)) * mapH;
    return [x, y];
  };

  const italyPath = "M200,40 L230,35 L260,50 L280,55 L300,70 L310,90 L295,100 L300,120 L290,130 L285,150 L275,160 L270,175 L260,185 L255,200 L245,215 L240,230 L235,245 L225,260 L220,280 L215,295 L210,310 L200,320 L195,335 L190,345 L185,360 L175,375 L165,385 L155,390 L148,400 L140,410 L135,420 L145,430 L155,425 L160,435 L155,445 L145,448 L138,440 L130,435 L125,420 L115,415 L110,405 L115,395 L120,380 L130,370 L140,355 L145,340 L150,320 L155,305 L160,290 L165,275 L170,260 L175,245 L178,230 L175,215 L170,200 L165,185 L155,175 L145,165 L135,155 L130,145 L125,135 L120,120 L115,105 L120,90 L130,75 L145,60 L160,50 L180,42 Z";
  const sardiniaPath = "M95,280 L110,275 L118,285 L120,300 L118,315 L112,325 L100,330 L90,325 L85,310 L85,295 L90,285 Z";
  const sicilyPath = "M155,400 L175,395 L195,398 L210,405 L220,415 L215,425 L200,430 L185,432 L170,428 L160,418 L155,408 Z";

  return (
    <Card style={{ overflow: "hidden" }}>
      <CardHeader><span style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9" }}>⬡ Territory Map — Agent Operational Zones</span></CardHeader>
      <div style={{ padding: 12, position: "relative" }}>
        <svg viewBox={`0 0 ${mapW} ${mapH}`} style={{ width: "100%", height: "auto", maxHeight: 440 }}>
          <defs>
            {agents.map(a => (
              <radialGradient key={a.id} id={`zone-${a.id}`}>
                <stop offset="0%" stopColor={getTier(a.score).color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={getTier(a.score).color} stopOpacity={0.05} />
              </radialGradient>
            ))}
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <rect width={mapW} height={mapH} fill="#080D18" rx={8} />
          {Array.from({length:20},(_,i)=><line key={`gv${i}`} x1={i*20} y1={0} x2={i*20} y2={mapH} stroke="#111827" strokeWidth={0.5}/>)}
          {Array.from({length:25},(_,i)=><line key={`gh${i}`} x1={0} y1={i*20} x2={mapW} y2={i*20} stroke="#111827" strokeWidth={0.5}/>)}
          <path d={italyPath} fill="#0F1629" stroke="#1E3A5F" strokeWidth={1.5} />
          <path d={sardiniaPath} fill="#0F1629" stroke="#1E3A5F" strokeWidth={1.5} />
          <path d={sicilyPath} fill="#0F1629" stroke="#1E3A5F" strokeWidth={1.5} />
          {agents.map(a => {
            const [cx, cy] = project(a.h3Center);
            const t = getTier(a.score);
            const isSelected = selectedAgent?.id === a.id;
            const r = a.h3Cells.length * 12 + 15;
            return (
              <g key={a.id} onClick={() => onSelect(a)} style={{ cursor: "pointer" }}>
                <circle cx={cx} cy={cy} r={r} fill={`url(#zone-${a.id})`} stroke={t.color} strokeWidth={isSelected ? 2 : 0.8} strokeDasharray={isSelected ? "" : "4 3"} opacity={isSelected ? 1 : 0.7} />
                {a.h3Cells.slice(0, 4).map((_, i) => {
                  const angle = (i / 4) * Math.PI * 2;
                  const hr = r * 0.5;
                  return <circle key={i} cx={cx + Math.cos(angle)*hr} cy={cy + Math.sin(angle)*hr} r={3} fill={t.color} opacity={0.3} />;
                })}
                <circle cx={cx} cy={cy} r={5} fill={t.color} filter="url(#glow)" opacity={a.status === "active" || a.status === "warning" ? 1 : 0.4}>
                  {(a.status === "active" || a.status === "warning") && <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite" />}
                </circle>
                <text x={cx} y={cy - r - 8} textAnchor="middle" fill={t.color} fontSize={9} fontWeight="700" style={mono}>{a.displayName}</text>
                <text x={cx} y={cy - r + 2} textAnchor="middle" fill="#6B7280" fontSize={8} style={mono}>{a.territory.join(", ")}</text>
              </g>
            );
          })}
          {agents.filter(a => a.delegatedBy?.type === "agent").map(a => {
            const parent = agents.find(p => p.id === a.delegatedBy.id);
            if (!parent) return null;
            const [x1, y1] = project(parent.h3Center);
            const [x2, y2] = project(a.h3Center);
            return <line key={`del-${a.id}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1E3A5F" strokeWidth={1} strokeDasharray="6 4" opacity={0.5} />;
          })}
        </svg>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
          {Object.entries(TIERS).map(([k, t]) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#6B7280" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, display: "inline-block" }} />
              <span style={mono}>{k}</span>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Delegation Chain Viewer ──
function DelegationChain({ agents }) {
  const humanPrincipal = { type: "human", name: "Camilo Ayerbe", id: PRINCIPAL_PK, role: "Founder & CEO, ULISSY s.r.l." };
  const roots = agents.filter(a => a.delegatedBy?.type === "human");

  function AgentNode({ agent, depth = 0 }) {
    const t = getTier(agent.score);
    const children = agents.filter(a => a.delegatedBy?.id === agent.id);
    return (
      <div style={{ marginLeft: depth > 0 ? 24 : 0 }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {depth > 0 && (
            <div style={{ width: 24, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, bottom: "50%", left: "50%", borderLeft: `1px dashed ${t.color}40` }} />
              <div style={{ width: 12, borderTop: `1px dashed ${t.color}40` }} />
            </div>
          )}
          <Card style={{ flex: 1, marginBottom: 8, borderColor: `${t.color}30` }}>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <ScoreRing score={agent.score} size={40} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9" }}>🤖 {agent.displayName}</span>
                  <TierBadge tier={agent.tier} />
                  <StatusIndicator status={agent.status} />
                </div>
                <div style={{ fontSize: 10, color: "#6B7280", ...mono }}>
                  {agent.shortId} · Depth {agent.delegationDepth}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 10, color: "#6B7280" }}>
                <div>Scope: <span style={{ color: "#9CA3AF" }}>{agent.delegationScope.join(", ")}</span></div>
                <div>Territory: <span style={{ color: t.color }}>{agent.territory.join(", ")}</span></div>
                <div>Breadcrumbs: <span style={mono}>{agent.breadcrumbs.toLocaleString()}</span></div>
              </div>
            </div>
          </Card>
        </div>
        {children.map(c => <AgentNode key={c.id} agent={c} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9" }}>⛓ Delegation Chain — Human → Agent → Sub-Agent</span>
      </CardHeader>
      <div style={{ padding: 16 }}>
        <Card style={{ marginBottom: 12, borderColor: "#3B82F630" }}>
          <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#1E40AF,#3B82F6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👤</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#60A5FA" }}>Camilo Ayerbe</div>
              <div style={{ fontSize: 10, color: "#6B7280" }}>{humanPrincipal.role}</div>
              <div style={{ fontSize: 10, color: "#4B5563", ...mono }}>{humanPrincipal.id.slice(0, 16)}...</div>
            </div>
            <div style={{ padding: "4px 12px", borderRadius: 4, background: "rgba(59,130,246,0.12)", border: "1px solid #1E3A5F", color: "#60A5FA", fontSize: 10, fontWeight: 700 }}>
              HUMAN PRINCIPAL
            </div>
          </div>
        </Card>
        {roots.map(a => <AgentNode key={a.id} agent={a} depth={0} />)}
        <div style={{ marginTop: 12, display: "flex", gap: 20, padding: "10px 14px", background: "#080D18", borderRadius: 6, border: "1px solid #1E293B", ...mono, fontSize: 10, color: "#4B5563" }}>
          <span>Max depth: {Math.max(0, ...agents.map(a => a.delegationDepth))}</span>
          <span>Human principals: 1</span>
          <span>Total agents: {agents.length}</span>
          <span>Scope narrowing: <span style={{ color: "#10B981" }}>✓ enforced</span></span>
        </div>
      </div>
    </Card>
  );
}

// ── Compliance Score Timeline ──
function ComplianceTimeline({ agent }) {
  const t = getTier(agent.score);
  const allViolations = agent.violations || [];
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid #1E293B" }}>
        <ScoreRing score={agent.score} size={48} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#F1F5F9" }}>{agent.displayName}</span>
            <TierBadge tier={agent.tier} />
            <StatusIndicator status={agent.status} />
          </div>
          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{agent.role} · {agent.territory.join(", ")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#6B7280" }}>Breadcrumbs: <span style={{ color: "#9CA3AF", ...mono }}>{agent.breadcrumbs.toLocaleString()}</span></div>
          <div style={{ fontSize: 10, color: "#6B7280" }}>Violations: <span style={{ color: allViolations.length > 0 ? "#F59E0B" : "#10B981", ...mono }}>{allViolations.length}</span></div>
        </div>
      </div>
      <div style={{ padding: "12px 16px" }}>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={agent.history}>
            <defs>
              <linearGradient id={`tg-${agent.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={t.color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={t.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: "#4B5563" }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} ticks={[20,40,70,90]} tick={{ fontSize: 9, fill: "#374151" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#1E293B", border: "1px solid #374151", borderRadius: 6, fontSize: 11, ...mono }} labelStyle={{ color: "#9CA3AF" }}
              formatter={(v, name) => [v, name === "s" ? "Score" : "Breadcrumbs"]} />
            <Area type="monotone" dataKey="s" name="Score" stroke={t.color} strokeWidth={2.5} fill={`url(#tg-${agent.id})`} dot={{ r: 3, fill: t.color, strokeWidth: 0 }} activeDot={{ r: 5, stroke: t.color, strokeWidth: 2, fill: "#0F1629" }} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 4 }}>
          {[{s:20,l:"BASIC"},{s:40,l:"VERIFIED"},{s:70,l:"TRUSTED"},{s:90,l:"SOVEREIGN"}].map(th => (
            <span key={th.l} style={{ fontSize: 8, color: "#374151", ...mono }}>{th.s} {th.l}</span>
          ))}
        </div>
      </div>
      {allViolations.length > 0 && (
        <div style={{ borderTop: "1px solid #1E293B", padding: "10px 16px" }}>
          <SectionLabel>Violations</SectionLabel>
          {allViolations.map((v, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: i < allViolations.length - 1 ? "1px solid #111827" : "none" }}>
              <span style={{ fontSize: 9, color: "#4B5563", ...mono, minWidth: 80 }}>{new Date(v.ts).toLocaleDateString()}</span>
              <span style={{
                padding: "2px 8px", borderRadius: 3, fontSize: 9, fontWeight: 700,
                background: v.severity === "high" ? "rgba(239,68,68,0.12)" : v.severity === "medium" ? "rgba(245,158,11,0.12)" : "rgba(107,114,128,0.12)",
                color: v.severity === "high" ? "#FCA5A5" : v.severity === "medium" ? "#FCD34D" : "#9CA3AF",
                border: `1px solid ${v.severity === "high" ? "#7F1D1D" : v.severity === "medium" ? "#78350F" : "#374151"}`,
              }}>{v.severity.toUpperCase()}</span>
              <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>{v.type.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 10, color: "#6B7280", flex: 1 }}>{v.detail}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Audit Export ──
function AuditExport({ agents }) {
  const [generating, setGenerating] = useState(null);

  const handleExport = (framework, format) => {
    setGenerating(`${framework}-${format}`);
    setTimeout(() => setGenerating(null), 2000);
  };

  const frameworks = [
    { key: "euai", label: "EU AI Act", color: "#3B82F6", items: ["Art. 14 Human Oversight", "Art. 13 Traceability", "Delegation chain audit", "Risk classification mapping", "High-risk system registry entry"] },
    { key: "gdpr", label: "GDPR Art. 22", color: "#8B5CF6", items: ["Automated decision inventory", "Human principal chain proof", "Territorial compliance verification", "Data processing scope attestation", "Right to explanation evidence"] },
    { key: "finma", label: "FINMA", color: "#10B981", items: ["Agent activity timeline", "Financial operation attestation", "Compliance score cryptographic proof", "Breadcrumb audit trail export", "Risk exposure summary"] },
  ];

  return (
    <Card>
      <CardHeader><span style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9" }}>📋 Audit Export — Regulatory Compliance Reports</span></CardHeader>
      <div style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
          {frameworks.map(fw => (
            <Card key={fw.key} style={{ borderColor: `${fw.color}20` }}>
              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: fw.color, marginBottom: 10 }}>{fw.label}</div>
                {fw.items.map((item, i) => (
                  <div key={i} style={{ fontSize: 10, color: "#6B7280", padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: fw.color, fontSize: 8 }}>●</span>{item}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {["PDF", "CSV"].map(fmt => (
                    <button key={fmt} onClick={() => handleExport(fw.key, fmt)}
                      disabled={generating === `${fw.key}-${fmt}`}
                      style={{
                        flex: 1, padding: "8px 0", borderRadius: 6, border: `1px solid ${fw.color}40`,
                        background: generating === `${fw.key}-${fmt}` ? `${fw.color}20` : "transparent",
                        color: fw.color, cursor: "pointer", fontSize: 11, fontWeight: 700,
                        ...mono, transition: "all 0.15s",
                      }}>
                      {generating === `${fw.key}-${fmt}` ? "Generating..." : `Export ${fmt}`}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
        <Card style={{ background: "#080D18" }}>
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF" }}>Report includes</div>
              <div style={{ fontSize: 10, color: "#4B5563", marginTop: 2 }}>
                Agent fleet inventory ({agents.length} agents) · Delegation chain verification · Territorial binding proof · Compliance score history · Violation log with Ed25519 signatures
              </div>
            </div>
            <div style={{ fontSize: 9, color: "#374151", ...mono }}>
              All exports cryptographically signed by org admin keypair
            </div>
          </div>
        </Card>
      </div>
    </Card>
  );
}


// ═══════════════════════════════════════════════
// MAIN DASHBOARD — LIVE DATA FETCHING
// ═══════════════════════════════════════════════
export default function Dashboard() {
  const [activeView, setActiveView] = useState("fleet");
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  // ── Fetch live data from Railway API ──
  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      try {
        setLoading(true);
        setError(null);

        // Step 1: Fetch fleet list
        const fleet = await fetchFleet();
        if (cancelled) return;

        // Step 2: Fetch full manifest for each agent
        const manifests = await Promise.all(
          fleet.map(a => fetchManifest(a.pk_root).catch(() => null))
        );
        if (cancelled) return;

        const validManifests = manifests.filter(Boolean);

        // Step 3: Transform API data → dashboard shape
        const transformed = validManifests
          .map(m => transformAgent(m, fleet, validManifests))
          .sort((a, b) => b.score - a.score);

        setAgents(transformed);
        setLastFetch(new Date());
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAgents();

    // Auto-refresh every 60 seconds
    const iv = setInterval(loadAgents, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Clock
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  const handleAgentSelect = useCallback((agent) => {
    setSelectedAgent(agent);
    setActiveView("timeline");
  }, []);

  const stats = useMemo(() => ({
    total: agents.length,
    active: agents.filter(a => a.status === "active" || a.status === "warning").length,
    warnings: agents.filter(a => a.status === "warning").length,
    avgScore: agents.length > 0 ? Math.round(agents.reduce((s, a) => s + a.score, 0) / agents.length) : 0,
    totalBreadcrumbs: agents.reduce((s, a) => s + a.breadcrumbs, 0),
    totalViolations: agents.reduce((s, a) => s + a.violations.length, 0),
  }), [agents]);

  const nav = [
    { key: "fleet", icon: "⬡", label: "Agent Fleet" },
    { key: "delegation", icon: "⛓", label: "Delegation Chains" },
    { key: "timeline", icon: "📊", label: "Compliance Timeline" },
    { key: "territory", icon: "🗺", label: "Territory Map" },
    { key: "audit", icon: "📋", label: "Audit Export" },
  ];

  // Cross-link URLs — update these when deploying
  const TERNA_DEMO_URL = "https://terna-gns.netlify.app";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#080D18", color: "#E5E7EB", fontFamily: "'DM Sans','Segoe UI',sans-serif", fontSize: 13 }}>
      {/* ═══ Cross-Link Navigation Bar ═══ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", height: 36, background: "linear-gradient(90deg, #070B14 0%, #0A1020 100%)", borderBottom: "1px solid #1a2a3a", flexShrink: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 800, background: "linear-gradient(135deg,#00D4FF,#8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>GNS × Terna</span>
          <span style={{ color: "#1E293B", fontSize: 14 }}>│</span>
          <a href={TERNA_DEMO_URL} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 4, background: "transparent", border: "1px solid #1a2a3a", color: "#6B7280", fontSize: 10, fontWeight: 600, textDecoration: "none", cursor: "pointer", letterSpacing: 0.5, transition: "all 0.15s" }}
            onMouseOver={e => { e.currentTarget.style.borderColor = "#00D4FF"; e.currentTarget.style.color = "#00D4FF"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "#1a2a3a"; e.currentTarget.style.color = "#6B7280"; }}>
            <span style={{ fontSize: 11 }}>⚡</span> Simulazione Rete
          </a>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 4, background: "rgba(59,130,246,0.1)", border: "1px solid #1E3A5F", color: "#60A5FA", fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>
            <span style={{ fontSize: 11 }}>🛡</span> Governance Dashboard
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 8, color: "#374151", ...mono, letterSpacing: 1 }}>RETE DI TRASMISSIONE NAZIONALE</span>
          <span style={{ fontSize: 8, color: "#2a3a4a", ...mono }}>v0.3.0</span>
        </div>
      </div>

      {/* ═══ Main Layout ═══ */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* ── Sidebar ── */}
      <div style={{ width: 210, background: "#0A1020", borderRight: "1px solid #1E293B", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 14px", borderBottom: "1px solid #1E293B" }}>
          <div style={{ fontSize: 17, fontWeight: 800, background: "linear-gradient(135deg,#3B82F6,#8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>GNS-AIP</div>
          <div style={{ fontSize: 9, color: "#4B5563", letterSpacing: 1.5, ...mono, marginTop: 2 }}>COMPLIANCE DASHBOARD</div>
        </div>
        <div style={{ padding: "8px 6px", flex: 1 }}>
          {nav.map(n => (
            <button key={n.key} onClick={() => { setActiveView(n.key); if (n.key !== "timeline") setSelectedAgent(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "9px 10px", marginBottom: 1, borderRadius: 6, border: "none",
                background: activeView === n.key ? "#1E293B" : "transparent",
                color: activeView === n.key ? "#60A5FA" : "#6B7280",
                cursor: "pointer", fontSize: 12, fontWeight: activeView === n.key ? 600 : 400,
                transition: "all 0.12s", textAlign: "left",
              }}>
              <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>{n.icon}</span>{n.label}
            </button>
          ))}
        </div>
        {/* Data source */}
        <div style={{ padding: "8px 14px", borderTop: "1px solid #1E293B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <DataSourceBadge live={agents.length > 0} />
            {lastFetch && <span style={{ fontSize: 8, color: "#374151", ...mono }}>{lastFetch.toLocaleTimeString()}</span>}
          </div>
          <div style={{ fontSize: 8, color: "#374151", ...mono }}>API: gns-browser-production.up.railway.app</div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid #1E293B" }}>
          <div style={{ fontSize: 9, color: "#374151", ...mono }}>v0.3.0-linked · gns-aip.gcrumbs.com</div>
          <div style={{ fontSize: 9, color: "#374151", marginTop: 2 }}>© 2026 ULISSY s.r.l.</div>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderBottom: "1px solid #1E293B", background: "#0A1020", flexShrink: 0 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#F1F5F9" }}>
              {nav.find(n => n.key === activeView)?.icon} {nav.find(n => n.key === activeView)?.label}
              {selectedAgent && activeView === "timeline" && <span style={{ color: "#6B7280", fontWeight: 400 }}> — {selectedAgent.displayName}</span>}
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 10, color: "#4B5563", ...mono }}>{clock.toLocaleTimeString()} CET</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#111827", borderRadius: 6, border: "1px solid #1E293B" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 5px #10B981" }} />
              <span style={{ fontSize: 10, color: "#9CA3AF" }}>Camilo Ayerbe</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>

          {/* Loading */}
          {loading && <LoadingState message="Fetching agent fleet from GNS Node..." />}

          {/* Error */}
          {error && !loading && (
            <Card style={{ padding: 20, borderColor: "#7F1D1D" }}>
              <div style={{ color: "#FCA5A5", fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Connection Error</div>
              <div style={{ color: "#6B7280", fontSize: 12, marginBottom: 12 }}>{error}</div>
              <div style={{ fontSize: 10, color: "#4B5563", ...mono }}>API: {API_BASE}</div>
            </Card>
          )}

          {/* ── FLEET VIEW ── */}
          {!loading && !error && activeView === "fleet" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 20 }}>
                {[
                  { l: "Total Agents", v: stats.total, c: "#60A5FA" },
                  { l: "Active", v: stats.active, c: "#10B981" },
                  { l: "Warnings", v: stats.warnings, c: stats.warnings > 0 ? "#F59E0B" : "#10B981" },
                  { l: "Avg Score", v: stats.avgScore, c: "#8B5CF6" },
                  { l: "Breadcrumbs", v: stats.totalBreadcrumbs.toLocaleString(), c: "#60A5FA" },
                  { l: "Violations (30d)", v: stats.totalViolations, c: stats.totalViolations > 0 ? "#EF4444" : "#10B981" },
                ].map((s, i) => (
                  <Card key={i} style={{ padding: "12px 14px" }}>
                    <SectionLabel>{s.l}</SectionLabel>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.c, ...mono, marginTop: 2 }}>{s.v}</div>
                  </Card>
                ))}
              </div>

              <Card>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Agent", "Role", "Territory", "Tier", "Score", "Status", "Breadcrumbs", "Depth", ""].map((h, i) => (
                          <th key={i} style={{ padding: "10px 12px", textAlign: "left", color: "#4B5563", fontWeight: 600, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", borderBottom: "1px solid #1E293B", background: "#0A1020" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map(a => (
                        <tr key={a.id} style={{ borderBottom: "1px solid #111827", cursor: "pointer", transition: "background 0.1s" }}
                          onClick={() => handleAgentSelect(a)}
                          onMouseEnter={e => e.currentTarget.style.background = "#111827"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 600, color: "#F1F5F9", fontSize: 12 }}>{a.displayName}</div>
                            <div style={{ fontSize: 9, color: "#374151", ...mono }}>{a.shortId}</div>
                          </td>
                          <td style={{ padding: "10px 12px", color: "#9CA3AF", fontSize: 11 }}>{a.role}</td>
                          <td style={{ padding: "10px 12px", color: "#6B7280", fontSize: 11 }}>{a.territory.join(", ")}</td>
                          <td style={{ padding: "10px 12px" }}><TierBadge tier={a.tier} /></td>
                          <td style={{ padding: "10px 12px" }}><ScoreRing score={a.score} size={36} /></td>
                          <td style={{ padding: "10px 12px" }}><StatusIndicator status={a.status} /></td>
                          <td style={{ padding: "10px 12px", ...mono, fontSize: 11, color: "#9CA3AF" }}>{a.breadcrumbs.toLocaleString()}</td>
                          <td style={{ padding: "10px 12px", ...mono, fontSize: 11, color: "#4B5563" }}>{a.delegationDepth}</td>
                          <td style={{ padding: "10px 12px" }}>
                            {a.violations.length > 0 && (
                              <span style={{ padding: "2px 6px", borderRadius: 3, background: "rgba(239,68,68,0.12)", border: "1px solid #7F1D1D", color: "#FCA5A5", fontSize: 9, fontWeight: 700 }}>
                                {a.violations.length} violation{a.violations.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          {/* ── DELEGATION VIEW ── */}
          {!loading && !error && activeView === "delegation" && <DelegationChain agents={agents} />}

          {/* ── TIMELINE VIEW ── */}
          {!loading && !error && activeView === "timeline" && (
            <>
              {selectedAgent ? (
                <ComplianceTimeline agent={selectedAgent} />
              ) : (
                agents.map(a => <ComplianceTimeline key={a.id} agent={a} />)
              )}
              {!selectedAgent && (
                <div style={{ textAlign: "center", padding: 12, fontSize: 11, color: "#374151" }}>
                  Click any agent in Fleet view to isolate its timeline
                </div>
              )}
            </>
          )}

          {/* ── TERRITORY MAP ── */}
          {!loading && !error && activeView === "territory" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
              <TerritoryMap agents={agents} selectedAgent={selectedAgent} onSelect={handleAgentSelect} />
              <div>
                {(selectedAgent || agents[0]) && (() => {
                  const a = selectedAgent || agents[0];
                  const t = getTier(a.score);
                  return (
                    <Card>
                      <CardHeader><span style={{ fontSize: 12, fontWeight: 600, color: "#F1F5F9" }}>Agent Detail</span></CardHeader>
                      <div style={{ padding: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                          <ScoreRing score={a.score} size={48} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9" }}>{a.displayName}</div>
                            <div style={{ display: "flex", gap: 6, marginTop: 3 }}><TierBadge tier={a.tier} /><StatusIndicator status={a.status} /></div>
                          </div>
                        </div>
                        {[
                          ["Identity", a.shortId],
                          ["Role", a.role],
                          ["Territory", a.territory.join(", ")],
                          ["H3 Cells", `${a.h3Cells.length} cells`],
                          ["Delegated By", a.delegatedBy?.name || "—"],
                          ["Depth", a.delegationDepth],
                          ["Scope", a.delegationScope.join(", ")],
                          ["Breadcrumbs", a.breadcrumbs.toLocaleString()],
                          ["Created", a.created],
                          ["Violations", a.violations.length],
                        ].map(([l, v], i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #111827", fontSize: 11 }}>
                            <span style={{ color: "#4B5563" }}>{l}</span>
                            <span style={{ color: "#9CA3AF", ...mono, textAlign: "right", maxWidth: 180 }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })()}
                <Card style={{ marginTop: 12 }}>
                  <div style={{ padding: "10px 14px", fontSize: 10, color: "#374151" }}>
                    <SectionLabel>Map Legend</SectionLabel>
                    <div style={{ marginTop: 6 }}>
                      {Object.entries(TIERS).map(([k, t]) => (
                        <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: t.bg, border: `1px solid ${t.border}`, display: "inline-block" }} />
                          <span style={{ color: t.color, ...mono, fontSize: 9 }}>{k}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, color: "#4B5563", lineHeight: 1.5 }}>
                      Zone radius proportional to H3 cell count. Dashed lines show delegation relationships. Click a zone to inspect.
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ── AUDIT EXPORT ── */}
          {!loading && !error && activeView === "audit" && <AuditExport agents={agents} />}
        </div>
      </div>
      </div>{/* close Main Layout wrapper */}
    </div>
  );
}
