/** Outstanding points are capped so a client cannot exhaust server memory. */
const maxPointsPerSession = 16;

/** Ids are handed out in sequence; 0 is reserved to mean "the last read". */
let lastRequestId = 0;

/**
 * Mints the identifier shared by a read's continuation point and its entry in
 * the last read ranges, so a client can ask about one of several concurrent
 * reads by quoting the continuation point it was given.
 */
export function newRequestId(): number {
  lastRequestId = (lastRequestId % 0xffffffff) + 1;

  return lastRequestId;
}

/** A point is its request id, so a client can read the one as the other. */
export function toPoint(requestId: number): Buffer {
  const point = Buffer.alloc(4);
  point.writeUInt32BE(requestId);

  return point;
}

export function toRequestId(point: Buffer): number | undefined {
  return point.length === 4 ? point.readUInt32BE() : undefined;
}

/**
 * Stores the remainder of a history read so the next request can resume where
 * the previous one stopped. Points are scoped to the session that created them
 * and are discarded with it.
 */
export default class ContinuationPoints<T> {
  private readonly bySession = new WeakMap<object, Map<number, T>>();

  /**
   * Retains the given state and returns its point, or null when the session
   * already holds as many as it is allowed. Every page of a read reuses the
   * read's own id, so the point a client quotes never goes stale mid-read.
   */
  register(
    session: object | undefined,
    requestId: number,
    state: T
  ): Buffer | null {
    if (session === undefined) {
      return null;
    }

    const points = this.pointsFor(session);

    if (!points.has(requestId) && points.size >= maxPointsPerSession) {
      return null;
    }

    points.set(requestId, state);

    return toPoint(requestId);
  }

  /** Consumes a point. A point is valid for a single continuation only. */
  take(session: object | undefined, point: Buffer): T | undefined {
    if (session === undefined) {
      return undefined;
    }

    const requestId = toRequestId(point);

    if (requestId === undefined) {
      return undefined;
    }

    const points = this.pointsFor(session);
    const state = points.get(requestId);
    points.delete(requestId);

    return state;
  }

  release(session: object | undefined, point: Buffer): void {
    if (session === undefined) {
      return;
    }

    const requestId = toRequestId(point);

    if (requestId !== undefined) {
      this.pointsFor(session).delete(requestId);
    }
  }

  private pointsFor(session: object): Map<number, T> {
    let points = this.bySession.get(session);

    if (points === undefined) {
      points = new Map();
      this.bySession.set(session, points);
    }

    return points;
  }
}
