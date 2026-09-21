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
}

/**
 * Remembers the time span each session's most recent event history read
 * returned, which is what getTotalRecords reports.
 */
export class LastReadRanges {
  private readonly bySession = new WeakMap<object, ReturnedRange>();

  record(session: object | undefined, first: Date, last: Date): void {
    if (session !== undefined) {
      this.bySession.set(session, { first, last });
    }
  }

  /** A read returning nothing clears the range, so no stale span is reported. */
  clear(session: object | undefined): void {
    if (session !== undefined) {
      this.bySession.delete(session);
    }
  }

  get(session: object | undefined): ReturnedRange | undefined {
    return session === undefined ? undefined : this.bySession.get(session);
  }
}

/**
 * Adds the HistoryManager object and its getTotalRecords method. The method
 * reports the range covered by the calling session's last history read, which
 * clients use to paginate, and an empty string when there has been no read.
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
    inputArguments: [],
    outputArguments: [
      {
        name: "Result",
        description: { text: "Range covered by the last history read, as XML" },
        dataType: DataType.String
      }
    ]
  });

  method.bindMethod((_inputArguments, context, callback) => {
    const range = ranges.get(context.session as object | undefined);

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

function toXml({ first, last }: ReturnedRange): string {
  return (
    "<HistoryReadResult>" +
    "<ReturnedRange>" +
    `<FirstTimestamp>${first.toISOString()}</FirstTimestamp>` +
    `<LastTimestamp>${last.toISOString()}</LastTimestamp>` +
    "</ReturnedRange>" +
    "</HistoryReadResult>"
  );
}
