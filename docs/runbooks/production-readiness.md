# Production Readiness Checklist

This checklist tracks the remaining work to reach a safe production launch.

- [ ] CI gates: lockfile, build, unit/coverage, Playwright install, smoke, E2E, and artifact upload are configured and pass locally; a hosted main-branch run is still required
- [x] E2E: Node 2 serialized functional suite passes 9/9; final smoke passes 16/16; final Chromium UI/transport passes 4/4
- [x] Load testing: Node 2 signed-registry N=100 passes 100/100 registrations, 100/100 lookups, and 9,900/9,900 routes with zero errors and zero `NO_RESERVATION` delta
- [x] Pin & audit: libp2p/crypto-critical and relay runtime deps are pinned; the production audit reports zero vulnerabilities at every severity
- [x] Monitoring: `/metrics`, alerting, dashboards
- [x] Backups: relay seed backup and recovery plan
- [ ] Secrets: TLS certs, tokens, key rotation policy
- [ ] Security audit: external pen-test scheduled
- [x] Runbooks: deploy, rollback, incident response ready
- [ ] Legal & privacy: privacy policy and data-residency check

Node 2 validation notes (2026-09-03):
- Playwright Chromium and system dependencies are installed.
- Relay restart, member disconnect/reconnect, and concurrent group churn pass 4/4 on the final relay build.
- A 10-browser group passes. A 50-browser run was stopped at 32 contexts after exhausting the Node 2 8 GiB memory allocation and 2 GiB swap; this is a lab-capacity limit, not a passing result. Use a 16 GiB dedicated runner or shard the scenario before enabling it as a gate.

Next actions:
- Run the main-branch CI workflow and retain its hosted artifacts.
- Configure production TLS/tokens and exercise the documented rotation policy.
- Schedule the independent audit / penetration test.
- Complete the privacy-policy and data-residency review.
