import { Stringable } from "../types.js";
import { RedisObserverDriverOptions } from "./subscriber.js";
import { FindCursorWithDescription } from "./types.js";

export * from "./types.js";

export { WithCursorDescription } from "mongo-collection-helpers";
export * from "./subscriber.js";
export * from "./manager.js";
export * from "./utils.js";

export * from "./constants.js";
export * from "./publish.js";
export * from "./subManager.js";

export { getChannels } from "./getChannels.js";


export function canUseRedisOplog<T extends { _id: Stringable }>(
  cursor: FindCursorWithDescription<T>,
  options: Pick<RedisObserverDriverOptions<T>, "Matcher" | "compileProjection" | "disableOplog">
) {
  if (options?.disableOplog) {
    return false;
  }
  const projection = cursor.cursorDescription.options?.projection;
  if (projection) {
    try {
      if (typeof options.compileProjection !== "function") {
        return false;
      }
      options.compileProjection(projection);
    }
    catch (e) {
      return false;
    }
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
