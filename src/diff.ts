import { OrderedDict } from "./orderedDict.js";
import { StringableIdMap } from "./stringableIdMap.js";
import { Clone, Equals, ObserveChangesObserver, Stringable, naiveClone, naiveEquals, stringId } from "./types.js";


function diffObjects<T extends object>(
  left: T,
  right: T,
  callbacks: {
    leftOnly?: <K extends keyof T & string>(key: K, value: T[K]) => void,
    rightOnly?: <K extends keyof T & string>(key: K, value: T[K]) => void,
    both?: <K extends keyof T>(key: K, leftValue: T[K], rightValue: T[K]) => void,
  }
): void {
  (Object.keys(left) as (keyof T & string)[]).forEach(key => {
    const leftValue = left[key];
    if (Object.hasOwnProperty.call(right, key)) {
      callbacks.both && callbacks.both(key, leftValue, right[key]);
    } else {
      callbacks.leftOnly && callbacks.leftOnly(key, leftValue);
    }
  });

  if (callbacks.rightOnly) {
    (Object.keys(right) as (keyof T & string)[]).forEach(key => {
      const rightValue = right[key];
      if (!Object.hasOwnProperty.call(left, key)) {
        // @ts-expect-error callbacks.rightOnly is defined.
        callbacks.rightOnly(key, rightValue);
      }
    });
  }
}

export function makeChangedFields<T extends object>(
  oldDoc: T,
  newDoc: T,
  {
    equals = naiveEquals
  }: { equals?: Equals } = {}): { hasChanges: boolean, changes: Partial<T> } {
  const diffDoc: Partial<T> = {};
  let hasChanges = false;
  diffObjects(oldDoc, newDoc, {
    leftOnly: function (key, value) {
      diffDoc[key] = undefined;
      hasChanges = true;
    },
    rightOnly: function (key, value) {
      diffDoc[key] = value;
      hasChanges = true;
    },
    both: function (key, leftValue, rightValue) {
      if (!equals(leftValue, rightValue)) {
        diffDoc[key] = rightValue;
        hasChanges = true;
      }
    }
  });

  return { changes: diffDoc, hasChanges };
}


type DiffOptions = {
  clone?: Clone,
  equals?: Equals,
  projectionFn?: <T>(doc: T) => any
}

export function diffQueryUnorderedChanges<ID extends Stringable, T>(
  oldResults: StringableIdMap<ID, T>,
  newResults: StringableIdMap<ID, T>,
  observer: ObserveChangesObserver<ID, T>,
  {
    projectionFn = doc => doc,
    clone = naiveClone,
    equals = naiveEquals
  }: DiffOptions = {}
) {
  if (observer.observes("added") || observer.observes("changed")) {
    newResults.forEach((value, id) => {
      const oldDoc = oldResults.get(id);
      if (!oldDoc) {
        if (observer.observes("added") && observer.added) {
          observer.added(id, value);
        }
      }
      else {
        // presence of observer.changed doesn't mean it observes "changed" (multiplexer, handles, etc)
        if (observer.observes("changed") && observer.changed && !equals(value, oldDoc)) {
          const projectedNew = projectionFn(value);
          const projectedOld = projectionFn(oldDoc);
          var { hasChanges, changes: changedFields } = makeChangedFields(projectedOld, projectedNew, { equals });
          if (hasChanges) {
            observer.changed(id, changedFields);
          }
        }
      }
    });
  }
  if (observer.observes("removed") && observer.removed) {
    oldResults.forEach((value, id) => {
      if (!newResults.get(id)) {
        if (observer.removed) {
          observer.removed(id);
        }
      }
    });
  }
}


export function diffQueryOrderedChanges<T extends { _id: Stringable }> (
  oldResults: Array<T>,
  newResults: Array<T>,
  observer: ObserveChangesObserver<T["_id"], Omit<T, "_id">>,
  {
    projectionFn = doc => doc,
    clone = naiveClone,
    equals = naiveEquals
  }: DiffOptions = {}
) {
  var projectionFn = projectionFn || clone;

  var newPresenceOfId = new Set<string>();
  newResults.forEach(function (doc) {
    newPresenceOfId.add(stringId(doc._id));
  });

  var oldIndexOfId = new Map<string, number>();
  oldResults.forEach(function (doc, i) {
    oldIndexOfId.set(stringId(doc._id), i);
  });

  // ALGORITHM:
  //
  // To determine which docs should be considered "moved" (and which
  // merely change position because of other docs moving) we run
  // a "longest common subsequence" (LCS) algorithm.  The LCS of the
  // old doc IDs and the new doc IDs gives the docs that should NOT be
  // considered moved.

  // To actually call the appropriate callbacks to get from the old state to the
  // new state:

  // First, we call removed() on all the items that only appear in the old
  // state.

  // Then, once we have the items that should not move, we walk through the new
  // results array group-by-group, where a "group" is a set of items that have
  // moved, anchored on the end by an item that should not move.  One by one, we
  // move each of those elements into place "before" the anchoring end-of-group
  // item, and fire changed events on them if necessary.  Then we fire a changed
  // event on the anchor, and move on to the next group.  There is always at
  // least one group; the last group is anchored by a virtual "null" id at the
  // end.

  // Asymptotically: O(N k) where k is number of ops, or potentially
  // O(N log N) if inner loop of LCS were made to be binary search.


  //////// LCS (longest common sequence, with respect to _id)
  // (see Wikipedia article on Longest Increasing Subsequence,
  // where the LIS is taken of the sequence of old indices of the
  // docs in new_results)
  //
  // unmoved: the output of the algorithm; members of the LCS,
  // in the form of indices into new_results
  var unmoved: any[] = [];
  // max_seq_len: length of LCS found so far
  var maxSeqLen = 0;
  // seq_ends[i]: the index into new_results of the last doc in a
  // common subsequence of length of i+1 <= max_seq_len
  var N = newResults.length;
  var seq_ends = new Array(N);
  // ptrs:  the common subsequence ending with new_results[n] extends
  // a common subsequence ending with new_results[ptr[n]], unless
  // ptr[n] is -1.
  var ptrs = new Array(N);
  // virtual sequence of old indices of new results
  const oldIdxSeq = (newIndex: number): number => {
    const oldIndex = oldIndexOfId.get(stringId(newResults[newIndex]._id));
    if (oldIndex === undefined) {
      return -1;
    }
    return oldIndex;
  };
  const oldIndex = (id: string): number => {
    const oldIndex = oldIndexOfId.get(id);
    if (oldIndex === undefined) {
      return -1;
    }
    return oldIndex;
  }
  // for each item in new_results, use it to extend a common subsequence
  // of length j <= max_seq_len
  for(var i=0; i<N; i++) {
    if (oldIndexOfId.get(stringId(newResults[i]._id)) !== undefined) {
      var j = maxSeqLen;
      // this inner loop would traditionally be a binary search,
      // but scanning backwards we will likely find a subseq to extend
      // pretty soon, bounded for example by the total number of ops.
      // If this were to be changed to a binary search, we'd still want
      // to scan backwards a bit as an optimization.
      while (j > 0) {
        if (oldIdxSeq(seq_ends[j-1]) < oldIdxSeq(i))
          break;
        j--;
      }

      ptrs[i] = (j === 0 ? -1 : seq_ends[j-1]);
      seq_ends[j] = i;
      if (j + 1 > maxSeqLen) {
        maxSeqLen = j + 1;
      }
    }
  }

  // pull out the LCS/LIS into unmoved
  var idx = (maxSeqLen === 0 ? -1 : seq_ends[maxSeqLen - 1]);
  while (idx >= 0) {
    unmoved.push(idx);
    idx = ptrs[idx];
  }
  // the unmoved item list is built backwards, so fix that
  unmoved.reverse();

  // the last group is always anchored by the end of the result list, which is
  // an id of "null"
  unmoved.push(newResults.length);

  oldResults.forEach(function (doc) {
  if (!newPresenceOfId.has(stringId(doc._id)))
    observer.observes("removed") && observer.removed && observer.removed(doc._id);
  });

  // for each group of things in the new_results that is anchored by an unmoved
  // element, iterate through the things before it.
  let startOfGroup = 0;
  unmoved.forEach(function (endOfGroup) {
    const groupId = newResults[endOfGroup] ? newResults[endOfGroup]._id : undefined;
    let oldDoc, newDoc, fields, projectedNew, projectedOld;
    for (var i = startOfGroup; i < endOfGroup; i++) {
      newDoc = newResults[i];
      if (!oldIndexOfId.has(stringId(newDoc._id))) {
        fields = projectionFn(newDoc);
        observer.observes("addedBefore") && observer.addedBefore(newDoc._id, fields, groupId);
        observer.observes("added") && observer.added(newDoc._id, fields);
      }
      else {
        // moved
        oldDoc = oldResults[oldIndex(stringId(newDoc._id))];
        projectedNew = projectionFn(newDoc);
        projectedOld = projectionFn(oldDoc);
        const { hasChanges, changes: fields } = makeChangedFields(projectedOld, projectedNew, { equals });
        if (hasChanges) {
          observer.observes("changed") && observer.changed(newDoc._id, fields);
        }
        observer.observes("movedBefore") && observer.movedBefore(newDoc._id, groupId);
      }
    }
    if (groupId) {
      newDoc = newResults[endOfGroup];
      oldDoc = oldResults[oldIndex(stringId(newDoc._id))];
      projectedNew = projectionFn(newDoc);
      projectedOld = projectionFn(oldDoc);
      const { hasChanges, changes: fields } = makeChangedFields(projectedOld, projectedNew, { equals });
      if (hasChanges) {
        observer.observes("changed") && observer.changed(newDoc._id, fields);
      }
    }
    startOfGroup = endOfGroup + 1;
  });
};


export function applyChanges<T extends object>(doc: T, changeFields: Partial<T>) {
  (Object.keys(changeFields) as (keyof T & string)[]).forEach(key => {
    // question: Why is this necessary? doc[key] = value fails without it - somewhere a ({} | null) gets added.
    const value = changeFields[key] as T[typeof key] | undefined;
    if (typeof value === "undefined") {
      delete doc[key];
    }
    else {
      doc[key] = value;
    }
  });
};
