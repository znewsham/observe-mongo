import { Stringable, stringId } from "../types.js";
import { RedisOptions } from "./constants.js";

export function getChannels(defaultChannel: string, options: RedisOptions = {}, docIds?: Stringable[]) {
  const channels: string[] = [];
  if (options.channel) {
    channels.push(options.channel);
  }
  if (options.channels) {
    channels.push(...options.channels);
  }

  if (options.namespace) {
    channels.push(`${options.namespace}::${defaultChannel}`);
  }
  if (options.namespaces) {
    channels.push(...options.namespaces.map(namespace => `${namespace}::${defaultChannel}`));
  }
  if (channels.length === 0) {
    channels.push(defaultChannel);
    if (docIds) {
      docIds.forEach(docId => channels.push(`${defaultChannel}::${typeof docId === "string" ? docId : stringId(docId)}`));
    }
  }
  return channels;
}
