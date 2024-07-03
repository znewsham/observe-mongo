import type { BSONRegExp, Filter, FilterOperators, FindOptions, ObjectId } from "mongodb";
import { Strategy } from "./constants.js";
import { RedisFindOptions } from "./types.js";
import { Stringable } from "../types.js";

enum OperationType {
  OID = "oid",
  FILTER = "filter"
};
function getType(id: (ObjectId | FilterOperators<Stringable>)): OperationType {
  const firstKey = Object.keys(id)[0];
  if (firstKey.startsWith("$")) {
    return OperationType.FILTER;
  }
  return OperationType.OID;
}

export function extractIdsFromSelector<T extends { _id: Stringable }>(selector: Filter<T>): Set<T["_id"]> {
  const ids = new Set<T["_id"]>();
  if (selector.$and) {
    // TODO: intersection.
    const andIds = selector.$and.map(extractIdsFromSelector);
    andIds.forEach(idSet => idSet.forEach(id => ids.add(id)));
  }
  if (selector._id) {
    if (typeof selector._id === "string" || typeof selector._id === "number") {
      ids.add(selector._id);
    }
    else if (selector._id instanceof RegExp || (selector._id as BSONRegExp)._bsontype === "BSONRegExp") {
      // do nothing
    }
    else {
      const idField: ObjectId | FilterOperators<Stringable> = selector._id as ObjectId | FilterOperators<Stringable>;
      const type = getType(idField);
      if (type === OperationType.FILTER) {
        const idFilter = idField as FilterOperators<Stringable>;
        idFilter.$in?.forEach(id => ids.add(id));
        if (idFilter.$eq) {
          ids.add(idFilter.$eq);
        }
      }
      else {
        ids.add(selector._id as ObjectId);
      }
    }
  }

  return ids;
}

export function getStrategy<T extends { _id: Stringable }> (
  selector: Filter<T> = {},
  options: RedisFindOptions & FindOptions<T>
): Strategy {
  if (options.limit && !options.sort) {
      options.sort = { _id: 1 };
      // throw new Meteor.Error(`Sorry, but you are not allowed to use "limit" without "sort" option.`);
  }

  if (/* options.limit && */options.sort) {
      return Strategy.LIMIT_SORT;
  }

  // if we're specifying a channel(s) - you better for sure know what you're doing, since we wont use the DEDICATED_CHANNELS stragey
  // (this is specifically for subEntriesCollections where the collectionName is entries, but we mostly want to listen for returns::_id)
  if (options.channel || options.channels) {
      return Strategy.DEFAULT;
  }

  if (selector && selector._id) {
      return Strategy.DEDICATED_CHANNELS;
  }

  return Strategy.DEFAULT;
}
