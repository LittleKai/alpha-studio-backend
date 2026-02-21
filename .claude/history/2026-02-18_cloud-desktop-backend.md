# Cloud Desktop Backend - 2026-02-18

## Changes

### New Models
- **HostMachine.js**: Cloud host machine registry (name, machineId, agentUrl, secret, status, specs, maxContainers, currentContainers, lastPingAt, enabled)
- **CloudSession.js**: Cloud desktop sessions (userId, hostMachineId, containerId, noVncUrl, status, startedAt, endedAt, endReason)

### New Routes (cloud.js)
- **User routes** (authMiddleware): POST /connect, POST /disconnect, GET /session
- **Agent route** (secret-based): POST /heartbeat
- **Admin routes** (authMiddleware + adminOnly): GET/POST/PUT /admin/machines, PATCH /admin/machines/:id/toggle, GET /admin/sessions, POST /admin/sessions/:id/force-end

### Modified Files
- **index.js**: Added cloud routes import, node-cron import, route mounting, 60s cron job for heartbeat checking
- **package.json**: Added node-cron dependency

### Dependencies
- node-cron (cron job for offline machine detection)

## Cross-references
- Frontend: alpha-studio/.claude/history/2026-02-18_cloud-desktop-frontend.md
- Host Agent: alpha-studio-host-agent/ (new standalone project)
