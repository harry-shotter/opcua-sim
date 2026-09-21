import {
  DataType,
  StatusCodes,
  Variant,
  type AddressSpace,
  type Namespace
} from "node-opcua";

interface ReturnedRange {
  first: Date;
  last: Date;
  /** Records matching the whole read, not just the page that was returned. */
  total: number;
}

/** Reads a session can still be asked about, alongside its most recent one. */
interface SessionReads {
  latest?: ReturnedRange;
  byRequest: Map<number, ReturnedRange>;
}

/** Matches the continuation point cap, so ids outlive the reads that issued them. */
const maxReadsPerSession = 16;

/**
 * Remembers the time span and size of each session's event history reads, which
 * is what getTotalRecords reports. Reads are keyed by the request id a client
 * quotes, so concurrent reads with different filters stay distinct.
 */
export class LastReadRanges {
  private readonly bySession = new WeakMap<object, SessionReads>();

  record(
    session: object | undefined,
    requestId: number | undefined,
    first: Date,
    last: Date,
    total: number
  ): void {
    if (session === undefined) {
      return;
    }

    const reads = this.readsFor(session);
    const range = { first, last, total };
    reads.latest = range;

    if (requestId !== undefined) {
      reads.byRequest.delete(requestId);

      if (reads.byRequest.size >= maxReadsPerSession) {
        // oldest first, so a long lived session cannot accumulate reads
        reads.byRequest.delete(reads.byRequest.keys().next().value!);
      }

      reads.byRequest.set(requestId, range);
    }
  }

  /** A read returning nothing clears the range, so no stale span is reported. */
  clear(session: object | undefined, requestId?: number): void {
    if (session === undefined) {
      return;
    }

    const reads = this.readsFor(session);
    reads.latest = undefined;

    if (requestId !== undefined) {
      reads.byRequest.delete(requestId);
    }
  }

  /** A request id of 0 asks about the session's most recent read. */
  get(session: object | undefined, requestId = 0): ReturnedRange | undefined {
    if (session === undefined) {
      return undefined;
    }

    const reads = this.bySession.get(session);

    if (reads === undefined) {
      return undefined;
    }

    return requestId === 0 ? reads.latest : reads.byRequest.get(requestId);
  }

  private readsFor(session: object): SessionReads {
    let reads = this.bySession.get(session);

    if (reads === undefined) {
      reads = { byRequest: new Map() };
      this.bySession.set(session, reads);
    }

    return reads;
  }
}

/**
 * Adds the HistoryManager object and its getTotalRecords method. The method
 * reports the range covered by a history read and how many records that read
 * matched in total, which clients use to paginate, and an empty string when
 * the read is not one this session can still be asked about.
 */
export default function installHistoryManager(
  namespace: Namespace,
  addressSpace: AddressSpace,
  ranges: LastReadRanges
): void {
  const historyManager = namespace.addObject({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "HistoryManager",
    nodeId: `ns=${namespace.index};s=HistoryManager`
  });

  const method = namespace.addMethod(historyManager, {
    browseName: "getTotalRecords",
    nodeId: `ns=${namespace.index};s=getTotalRecords`,
    inputArguments: [
      {
        name: "RequestId",
        description: {
          text: "Continuation point of the read, as a UInt32, or 0 for the last read"
        },
        dataType: DataType.UInt32
      }
    ],
    outputArguments: [
      {
        name: "Result",
        description: {
          text: "Range and record count of the identified read, as XML"
        },
        dataType: DataType.String
      }
    ]
  });

  method.bindMethod((inputArguments, context, callback) => {
    const requestId = inputArguments[0]?.value;
    const range = ranges.get(
      context.session as object | undefined,
      typeof requestId === "number" ? requestId : 0
    );

    callback(null, {
      statusCode: StatusCodes.Good,
      outputArguments: [
        new Variant({
          dataType: DataType.String,
          value: range === undefined ? "" : toXml(range)
        })
      ]
    });
  });
}

function toXml({ first, last, total }: ReturnedRange): string {
  return (
    "<HistoryReadResult>" +
    `<TotalRecords>${total}</TotalRecords>` +
    "<ReturnedRange>" +
    `<FirstTimestamp>${first.toISOString()}</FirstTimestamp>` +
    `<LastTimestamp>${last.toISOString()}</LastTimestamp>` +
    "</ReturnedRange>" +
    "</HistoryReadResult>"
  );
}
