# GNS-AIP Compliance Dashboard

**AI Agent Governance Dashboard for Terna S.p.A.**

Live-wired React dashboard fetching agent fleet data from the GNS Node backend (Railway → Supabase).

## Architecture

```
┌─────────────────────┐     ┌─────────────────────────────────┐     ┌──────────────┐
│  This Dashboard     │────▶│  Railway Backend                │────▶│  Supabase    │
│  (Netlify)          │     │  gns-browser-production.up.     │     │  PostgreSQL  │
│  terna-aip.netlify  │     │  railway.app                    │     │              │
└─────────────────────┘     └─────────────────────────────────┘     └──────────────┘
```

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /agents?principal={pk}` | List all agents for principal |
| `GET /agents/:pk/manifest` | Full agent manifest with compliance |
| `GET /agents/:pk/compliance` | Compliance score breakdown |

### Companion Demo

**Simulazione Rete** — Grid operations simulator (vanilla JS)  
Hosted at: [terna-gns.netlify.app](https://terna-gns.netlify.app)

Both demos share a cross-link navigation bar for seamless navigation.

## Deploy

```bash
npm install
npm run build    # → build/ directory
```

Netlify auto-deploys from `main` branch. Build command: `npm run build`, publish dir: `build`.

## Stack

- React 18 + Recharts
- Live data from Railway/Supabase (60s auto-refresh)
- DM Sans + JetBrains Mono typography
- Dark theme (#080D18)

---

**v0.3.0-linked** · © 2026 ULISSY s.r.l.
