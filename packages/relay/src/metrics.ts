import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Reservation metrics
export const reservationsCreated = new Counter({ name: 'kant_relay_reservations_created_total', help: 'Total number of circuit reservations created', registers: [registry] });
export const reservationsRemoved = new Counter({ name: 'kant_relay_reservations_removed_total', help: 'Total number of circuit reservations removed', registers: [registry], labelNames: ['reason'] });
export const reservationsActive = new Gauge({ name: 'kant_relay_reservations_active', help: 'Current number of active circuit reservations', registers: [registry] });
export const reservationsTracked = new Gauge({ name: 'kant_relay_reservations_tracked', help: 'Current number of reservations tracked by admin endpoint', registers: [registry] });
export const reservationErrors = new Counter({ name: 'kant_relay_reservation_errors_total', help: 'Total number of reservation errors', registers: [registry], labelNames: ['code'] });

// Admin metrics
export const adminEvictions = new Counter({ name: 'kant_relay_admin_evictions_total', help: 'Total number of manual admin evictions', registers: [registry] });

// Circuit metrics
export const circuitsOpened = new Counter({ name: 'kant_relay_circuits_opened_total', help: 'Total number of circuits opened', registers: [registry], labelNames: ['direction'] });
export const circuitsClosed = new Counter({ name: 'kant_relay_circuits_closed_total', help: 'Total number of circuits closed', registers: [registry], labelNames: ['direction', 'reason'] });
export const circuitDuration = new Histogram({ name: 'kant_relay_circuit_duration_seconds', help: 'Circuit duration in seconds', registers: [registry], buckets: [1, 10, 60, 600, 3600, 21600] });

// Peer metrics
export const peersConnected = new Counter({ name: 'kant_relay_peers_connected_total', help: 'Total number of peer connections', registers: [registry] });
export const peersDisconnected = new Counter({ name: 'kant_relay_peers_disconnected_total', help: 'Total number of peer disconnections', registers: [registry] });
export const peersActive = new Gauge({ name: 'kant_relay_peers_active', help: 'Current number of connected peers', registers: [registry] });

// Registry metrics
export const registryEntries = new Gauge({ name: 'kant_relay_registry_entries', help: 'Current number of registry entries by kind', registers: [registry], labelNames: ['kind'] });
export const registryEvictions = new Counter({ name: 'kant_relay_registry_evictions_total', help: 'Total number of registry evictions', registers: [registry], labelNames: ['reason'] });
export const registerRequests = new Counter({ name: 'kant_relay_register_requests_total', help: 'Total register requests', registers: [registry], labelNames: ['result'] });
export const lookupRequests = new Counter({ name: 'kant_relay_lookup_requests_total', help: 'Total lookup requests', registers: [registry], labelNames: ['result'] });
export const lookupHits = new Counter({ name: 'kant_relay_lookup_hits_total', help: 'Total lookup hits (entries found)', registers: [registry] });
export const lookupMisses = new Counter({ name: 'kant_relay_lookup_misses_total', help: 'Total lookup misses (entries not found)', registers: [registry] });
export const registerDuration = new Histogram({ name: 'kant_relay_register_request_duration_seconds', help: 'Register request duration in seconds', registers: [registry], buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5] });
export const lookupDuration = new Histogram({ name: 'kant_relay_lookup_request_duration_seconds', help: 'Lookup request duration in seconds', registers: [registry], buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5] });

// OPK/X3DH metrics (reported by clients via registry endpoint)
export const opkBurnFailures = new Counter({ name: 'kant_relay_opk_burn_failures_total', help: 'Total OPK burn failures reported by clients (OPK already consumed or missing)', registers: [registry] });

// Push notifications
export const pushWakes = new Counter({ name: 'kant_relay_push_wakes_total', help: 'Total push wake signals attempted, by transport and outcome', registers: [registry], labelNames: ['transport', 'result'] });
export const pushSubscriptionsGauge = new Gauge({ name: 'kant_relay_push_subscriptions', help: 'Current number of push subscriptions held by kind', registers: [registry], labelNames: ['kind'] });
export const lookupStaleEntries = new Counter({ name: 'kant_relay_lookup_stale_entries_total', help: 'Lookups that matched a registry entry whose circuit was no longer reachable', registers: [registry] });

// Readiness
export const relayReady = new Gauge({ name: 'kant_relay_ready', help: 'Relay readiness gate', registers: [registry], labelNames: ['gate'] });
