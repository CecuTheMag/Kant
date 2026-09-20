# Kant runbooks

This directory contains the operational documentation that matters for a production deployment of the Kant relay and its related hosting model. It intentionally excludes historical design notes and roadmap artifacts that are no longer part of the active product surface.

## Active runbooks

- [relay-deployment.md](./relay-deployment.md) — deploy a relay, configure TLS, and validate the public relay address
- [monitoring.md](./monitoring.md) — Prometheus metrics, alert thresholds, and Grafana guidance
- [incident-response.md](./incident-response.md) — response flow, severity handling, and escalation procedures
- [backup-recovery.md](./backup-recovery.md) — relay seed handling, recovery steps, and high-availability considerations
- [load-testing.md](./load-testing.md) — performance validation and capacity testing guidance
- [production-readiness.md](./production-readiness.md) — release gating and operational readiness checklist
- [system-requirements.md](./system-requirements.md) — minimum and recommended hardware sizing for relay, push proxy, and client platforms
- [deploy-kant.md](./deploy-kant.md) — interactive deployment of the push proxy and HTTP/HTTPS relay
- [release-process.md](./release-process.md) — promotion, rollback, and deployment hygiene for a production release

## Operating model

Kant's relay is intentionally small and operationally transparent:

- message content is not stored in the relay
- the relay acts as a bootstrap and route registry layer
- health and readiness endpoints are exposed for orchestrators and monitoring
- relay identity is persistent and should be backed up as part of operational hygiene
- the public relay host should be externalized behind a TLS terminator in internet-facing deployments

For the deployment narrative and deployment examples, see [RELAY_DEPLOY.md](../../RELAY_DEPLOY.md).

For the security posture and threat model, see [docs/security](../security/).

---

## Recommended use

Use this folder for:

- production deployment
- operational monitoring
- incident handling
- reliability validation
- release and rollback readiness

Do not treat this folder as a historical archive of product planning. The archive material has been removed from the active documentation set.
