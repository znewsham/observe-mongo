import { Stringable } from "../types.js";
import { RedisObserverDriverOptions } from "./subscriber.js";
import { FindCursorWithDescription } from "./types.js";

export * from "./types.js";

export { WithCursorDescription } from "mongo-collection-helpers";
export * from "./subscriber.js";
export * from "./manager.js";
export * from "./utils.js";

export * from "./constants.js";

export { getChannels } from "./getChannels.js";


export function canUseRedisOplog<T extends { _id: Stringable }>(
  cursor: FindCursorWithDescription<T>,
  options: Pick<RedisObserverDriverOptions<T>, "Matcher">
) {
  if (cursor.cursorDescription.options?.disableOplog) {
    return false;
  }
  if (cursor.cursorDescription.filter) {
    let matcher;
    try {
      matcher = new options.Matcher(cursor.cursorDescription.filter);
      if (matcher.hasWhere() || matcher.hasGeoQuery()) {
        return false;
      }
    }
    catch (e) {
      return false;
    }
  }
  return true;
}
