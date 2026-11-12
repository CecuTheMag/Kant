/**
 * `msg` added to a time-ordered message list: at the end as usual, or, for a
 * message stored with an earlier time (one that arrived late, placed by core's
 * placeReceived), before the first message with a later time. Equal times keep
 * arrival order.
 */
export function insertByTime<T extends { ts: number }>(list: readonly T[], msg: T): T[] {
  const last = list[list.length - 1];
  if (!last || last.ts <= msg.ts) return [...list, msg];
  const index = list.findIndex(m => m.ts > msg.ts);
  return [...list.slice(0, index), msg, ...list.slice(index)];
}
