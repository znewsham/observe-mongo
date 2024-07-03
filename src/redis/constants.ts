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
  channel?: string,
  channels?: string[],
  namespace?: string,
  namespaces?: string[],
  optimistic?: boolean,
  pushToRedis?: boolean
}
