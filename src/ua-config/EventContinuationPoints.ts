import { randomBytes } from "node:crypto";

/** Outstanding points are capped so a client cannot exhaust server memory. */
const maxPointsPerSession = 16;

/**
 * Stores the remainder of a history read so the next request can resume where
 * the previous one stopped. Points are scoped to the session that created them
 * and are discarded with it.
 */
export default class ContinuationPoints<T> {
  private readonly bySession = new WeakMap<object, Map<string, T>>();

  /**
   * Retains the given state and returns its point, or null when the session
   * already holds as many as it is allowed.
   */
  register(session: object | undefined, state: T): Buffer | null {
    if (session === undefined) {
      return null;
    }

    const points = this.pointsFor(session);

    if (points.size >= maxPointsPerSession) {
      return null;
    }

    const point = randomBytes(16);
    points.set(point.toString("hex"), state);

    return point;
  }

  /** Consumes a point. A point is valid for a single continuation only. */
  take(session: object | undefined, point: Buffer): T | undefined {
    if (session === undefined) {
      return undefined;
    }

    const points = this.pointsFor(session);
    const key = point.toString("hex");
    const state = points.get(key);
    points.delete(key);

    return state;
  }

  release(session: object | undefined, point: Buffer): void {
    if (session !== undefined) {
      this.pointsFor(session).delete(point.toString("hex"));
    }
  }

  private pointsFor(session: object): Map<string, T> {
    let points = this.bySession.get(session);

    if (points === undefined) {
      points = new Map();
      this.bySession.set(session, points);
    }

    return points;
  }
}
