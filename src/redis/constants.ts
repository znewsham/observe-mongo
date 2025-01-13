export enum RedisPipe {
  EVENT = "e",
  DOC = "d",
  FIELDS = "f",
  MODIFIER = "m",
  DOCUMENT_ID = "id",
  SYNTHETIC = "s",
  UID = "u", // this is the unique identity of a change request
  MODIFIED_TOP_LEVEL_FIELDS = "mt"
}

export enum Events {
  INSERT = "i",
  UPDATE = "u",
  REMOVE = "r"
}

export enum Strategy {
  DEFAULT = "D",
  DEDICATED_CHANNELS = "DC",
  LIMIT_SORT = "LS"
}

export type RedisOptions = {
  /**
   * The change will be published to this single channel - ignoring the default of collectionName + collectionName::id
   */
  channel?: string,
  /**
   * The change will be published to these channels - ignoring the default of collectionName + collectionName::id
   */
  channels?: string[],
  /**
   * The change will be published to this namespace, which prefixes the collectionName, it will still be sent to collectionName::id
   */
  namespace?: string,
  /**
   * The change will be published to these namespaces, which prefix the collectionName, it will still be sent to collectionName::id
   */
  namespaces?: string[],
  /**
   * Whether the operation is optimistic or not
   * @default true
   */
  optimistic?: boolean,
  /**
   * Whether to push the operation to redis
   * @default true
   */
  pushToRedis?: boolean
}
