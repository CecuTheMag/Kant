/**
 * Preloaded into the test relays (`node --import`): resolve `*.test` names to
 * 127.0.0.1, the same mapping the test browsers get from --host-resolver-rules.
 * Federated relays open tunnels to each other by the host a peer announces,
 * so without this a relay can't reach `relay-b.test`.
 */
import dns from 'node:dns';

const lookup = dns.lookup;
dns.lookup = function lookupTestHosts(host, options, callback) {
  if (typeof host === 'string' && host.endsWith('.test')) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (typeof options === 'number') options = { family: options };
    process.nextTick(() => (options?.all
      ? callback(null, [{ address: '127.0.0.1', family: 4 }])
      : callback(null, '127.0.0.1', 4)));
    return {};
  }
  return lookup.call(this, host, options, callback);
};
