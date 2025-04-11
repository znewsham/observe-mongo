import type { Collection, FindCursor, Document, ObjectId } from "mongodb";
import { StringableIdMap } from "./stringableIdMap.js";
import { OrderedDict } from "./orderedDict.js";


export const ObserveChangesCallbackNames: ObserveChangesCallbackKeys[] = [
  "added",
  "addedBefore",
  "changed",
  "movedBefore",
  "removed"
];

// we don't currently care about equals - but lots of things provide a "toString" - just not one that uniquely identifies the value.
export type Stringable = string
  // | { _bsonType: "ObjectId" } | { get _bsonType(): "ObjectId" } - insanely annoying, maybe because of the _, but I can't make this work.
  // | { toHexString() : string } // this is a proxy for ObjectId - see above.
  | Date
  | number
  | ObjectId
  | {[k in string]: Stringable }// Record<string, Stringable>
  | Stringable[];

type EJSONItem = { $type: "oid", $value: string } | { $type: "date", $value: number }
type Item = EJSONItem | string | number | { [k in string]: Item } | Item[];


function jsonable(stringable: Stringable): Item {
  if (typeof stringable === "string" || typeof stringable === "number") {
    return stringable;
  }
  if (stringable instanceof Date) {
    return { $type: "date", $value: stringable.getTime() };
  }
  if (Array.isArray(stringable)) {
    return stringable.map(s => jsonable(s));
  }
  if (stringable._bsontype === "ObjectId") {
    return { $type: "oid", $value: stringable.toString() };
  }
  return Object.fromEntries(Object.entries(stringable).map(([key, value]) => [key, jsonable(value)]));
}
// a poor mans EJSON. Maybe just suck it up and pull it in as a dependency
export function stringId(stringable: Stringable): string {
  if (typeof stringable === "string") {
    // this ensures compatibility with anything (e.g., meteor) and the common case of
    return stringable;
  }
  return JSON.stringify(jsonable(stringable));
}

function jsonToObject(json: { $type: "oid" | "date", $value: any } | { [k in string]: string | number | { $type: "oid" | "date", $value: any } }): Stringable {
  if (json.$type) {
    if (json.$type === "date") {
      return new Date(json.$value);
    }
    if (json.$type === "oid") {
      // we have to be insanely careful here - more recent versions of bson rely on top level await,
      // which is likely going to break vast amounts of our code. Deferring this to a peer dependency also doesn't help
      // since the peer dependency needs to be a sufficiently high version that the types match.
      // I hate relying on a global this way but it seems the least bad choice.
      // @ts-expect-error
      if (!globalThis.ObjectId) {
        throw new Error("You can't use ObjectId without providing a globalThis.ObjectId - come find this error code to find out more: '6683fce02d94bdf20801d560'")
      }
      // @ts-expect-error
      return new globalThis.ObjectId(json.$value) as ObjectId;
    }
    throw new Error(`Invalid $type: ${json.$type}`);
  }
  if (Array.isArray(json)) {
    return json.map(value => typeof value === "object" ? jsonToObject(value) : value);
  }
  return Object.fromEntries(Object.entries(json).map(([key, value]) => [key, typeof value === "object" ? jsonToObject(value) : value])) as { [k in string]: Stringable };
}

export function fromStringId(id: string): Stringable {
  if (!id.startsWith("[") && !id.startsWith("{")) {
    // we're looking at a simple ID - either a string or a number.
    // if it's a number, it's going to come out as a string, this...isn't great, but ensures compatibility with older systems
    return id;
  }
  const maybeObject = JSON.parse(id);
  if (typeof maybeObject === "object") {
    return jsonToObject(maybeObject);
  }
  return maybeObject as number | string;
}

export type Equals<T = any> = (doc1: T, doc2: T, options?: any) => boolean;

export function naiveEquals<T>(doc1: T, doc2: T): boolean {
  return JSON.stringify(doc1) === JSON.stringify(doc2);
}

export type Clone = <T>(doc: T) => T;
export function naiveClone<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc));
}

export type FindCursorWithOptionalMap<T> = FindCursor<T> & {
  _mapTransform?: <X>(doc: T) => X
}

export type ObserveOptions<T extends { _id: Stringable }> = {
  /** Interanal only - indicates the callbacks are ordered, will be calculated based on the provided callbacks */
  ordered?: boolean,

  /**
   * Set to true if the callbacks (or anything downstream) wont mutate the documents (avoids a clone). You should aim to always set this to true. This option applies to the observer and it's cache, not the multiplexer. For that use `cloneDocuments`
   * @default: false
   */
  nonMutatingCallbacks?: boolean,

  /**
   * Only interested in changes from this point forwards. Will skip the initial set of adds
   */
  suppressInitial?: boolean,

  /**
   * A "clone" implementation - like EJSON.clone.
   * @default: doc => JSON.parse(JSON.stringify(doc))
   */
  clone?: Clone,

  /**
   * Enable document cloning in the internal caching layer to prevent document mutation.
   * When true, documents will be cloned before being stored in the cache.
   * @default: false
   */
  cloneDocuments?: boolean,

  /**
   * An "equals" implementation - like EJSON.equals
   * @default: (doc1, doc2) => JSON.stringify(doc1) === JSON.stringify(doc2)
   */
  equals?: Equals,

  /** The transform of a collection - will be used for ObserveCallbacks */
  transform?: <T>(doc: Document) => T,

  /**
   * cursor.find().map().clone loses the map - if you're using
   * @default: true
   */
  retainCursorMap?: boolean

  /**
   * Whether to clone the cursor or not - if you want to use the map function of the cursor - and the cursor wont be used by anything else, you can specify the cursor should not be cloned.
   * @default: true
   */
  cloneCursor?: boolean
  driverClass?: ObserveDriverConstructor<T>
  multiplexerId?: (cursor: FindCursor<T>, collection: MinimalCollection<{ _id?: Stringable }>, options: ObserveOptions<T>) => string,

  /**
   * Whether to bind observe events to an asyncResource created when the observe handle is defined (e.g., all callbacks will be associated with the invoking async resource)
   * @default: true
   */
  bindObserveEventsToAsyncResource?: boolean
};

export type ObserveOnlyOptions = {
  /**
   * Whether to skip indices for the addedAt, etc callbacks. Only meaningful if the callbacks are ordered
   * @default: false
   */
  noIndices?: boolean;
}


export type RecursiveReadOnly<T> = {
  readonly [P in keyof T]: RecursiveReadOnly<T[P]>;
}

export type MinimalCollection<T extends Document> = Pick<Collection<T>, "find" | "findOne">

export type OrderedObserveChangesCallbacks<ID extends Stringable, T, READONLY extends boolean | undefined = undefined> = {
  addedBefore?: READONLY extends true ? (id: RecursiveReadOnly<ID>, doc: RecursiveReadOnly<T>, before: RecursiveReadOnly<ID> | undefined) => void | Promise<void> : (id: ID, doc: T, before: ID | undefined) => void | Promise<void>;
  movedBefore?: READONLY extends true ? (id: RecursiveReadOnly<ID>, before: RecursiveReadOnly<ID> | undefined) => void | Promise<void> : (id: ID, before: ID | undefined) => void | Promise<void> | Promise<void>;
}

export type SharedObserveChangesCallbacks<ID extends Stringable, T, READONLY extends boolean | undefined = undefined> = {
  changed?: READONLY extends true ? (id: RecursiveReadOnly<ID>, fields: Partial<RecursiveReadOnly<T>>) => void | Promise<void> : (id: ID, fields: Partial<T>) => void | Promise<void>;
  removed?: READONLY extends true ? (id: RecursiveReadOnly<ID>) => void | Promise<void> : (id: ID) => void | Promise<void>;
}

export type UnorderedObserveChangesCallbacks<ID extends Stringable, T, READONLY extends boolean | undefined = undefined> = {
  added?: READONLY extends true ? (id: RecursiveReadOnly<ID>, doc: RecursiveReadOnly<T>) => void | Promise<void> : (id: ID, doc: T) => void | Promise<void>;
}

export type OrderedObserveCallbacks<T, READONLY extends boolean | undefined = undefined> = {
  addedAt?: READONLY extends true ? (doc: RecursiveReadOnly<T>, index: number, before: RecursiveReadOnly<T> | undefined) => void | Promise<void> : (doc: T, index: number, before: T | undefined) => void | Promise<void>;
  changedAt?: READONLY extends true ? (newDoc: RecursiveReadOnly<T>, oldDoc: RecursiveReadOnly<T>, index: number) => void | Promise<void> : (newDoc: T, oldDoc: T, index: number) => void | Promise<void>;
  movedTo?: READONLY extends true ? (doc: RecursiveReadOnly<T>, from: number, to: number, before: RecursiveReadOnly<T> | undefined) => void | Promise<void> : (doc: T, from: number, to: number, before: T | undefined) => void | Promise<void>;
  removedAt?: READONLY extends true ? (doc: RecursiveReadOnly<T>, index: number) => void | Promise<void> : (doc: T, index: number) => void | Promise<void>;
}

export type UnorderedObserveCallbacks<T, READONLY extends boolean | undefined = undefined> = {
  added?: READONLY extends true ? (doc: RecursiveReadOnly<T>) => void | Promise<void> : (doc: RecursiveReadOnly<T>) => void | Promise<void>;
  changed?: READONLY extends true ? (newDoc: RecursiveReadOnly<T>, oldDoc: RecursiveReadOnly<T>) => void | Promise<void> : (newDoc: T, oldDoc: T) => void | Promise<void>;
  removed?: READONLY extends true ? (doc: RecursiveReadOnly<T>) => void | Promise<void> : (doc: T) => void | Promise<void>;
}

export type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
export type XOR<T, U> = (T | U) extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U;


export type ObserveCallbackOptions = {
  _suppress_initial?: boolean;
  _no_indices?: boolean;
};
export type ObserveMutatingCallbacks<T extends { _id: Stringable }> = XOR<OrderedObserveCallbacks<T, false>, UnorderedObserveCallbacks<T, false>>;
export type ObserveNonMutatingCallbacks<T extends { _id: Stringable }> = XOR<OrderedObserveCallbacks<T, true>, UnorderedObserveCallbacks<T, true>>;
export type ObserveCallbacks<T extends { _id: Stringable }> = ObserveMutatingCallbacks<T> | ObserveNonMutatingCallbacks<T>;

export type ObserveChangesNonMutatingCallbacks<ID extends Stringable, T> = XOR<(OrderedObserveChangesCallbacks<ID, T, true> & SharedObserveChangesCallbacks<ID, T, true>), (UnorderedObserveChangesCallbacks<ID, T, true> & SharedObserveChangesCallbacks<ID, T, true>)>;
export type ObserveChangesMutatingCallbacks<ID extends Stringable, T> = XOR<(OrderedObserveChangesCallbacks<ID, T, false> & SharedObserveChangesCallbacks<ID, T, false>), (UnorderedObserveChangesCallbacks<ID, T, false> & SharedObserveChangesCallbacks<ID, T, false>)>;
export type ObserveChangesCallbacks<ID extends Stringable, T> = ObserveChangesMutatingCallbacks<ID, T> | ObserveChangesNonMutatingCallbacks<ID, T>
export type ObserveChangesCallbackKeys = keyof ObserveChangesCallbacks<Stringable, {}>


export type ObserveHandle = {
  _id: number,
  stop(): void
};

export type Observer<T extends { _id: Stringable }> = {
  observeChanges(
    callbacks: ObserveChangesCallbacks<T["_id"], T>,
    options?: Pick<ObserveOptions<T>, "nonMutatingCallbacks">
  ): ObserveHandle | Promise<ObserveHandle>
}

export type ObserveDriverConstructor<T extends { _id: Stringable }> = {
  new(cursor: FindCursor<T>, collection: Collection<T>, options: any): ObserveDriver<T>
}


export type StringObjectWithoutID = Omit<{
  [k in string]: any
}, "_id">

export type ObserveMultiplexerInterface<
  ID extends Stringable,
  T extends StringObjectWithoutID,
> = ObserveChangesObserver<ID, T> & {
  ready(): void;

  /** retuns the actual set of docs (not cloned) after all pending changes have been made */
  getDocs() : Promise<OrderedDict<ID, T> | StringableIdMap<ID, T>>;
  /** checks whether a document exists after all pending changes have been made */
  has(id: Stringable): Promise<boolean>;
  /** retuns an actual doc (not cloned) after all pending changes have been made */
  get(id: Stringable): Promise<T | undefined>;
  /** ensures all changes have been made */
  flush(downstream?: boolean): Promise<void>;
}

export type ObserveDriver<T extends { _id: Stringable }> = {
  init(multiplexer: ObserveMultiplexerInterface<T["_id"], Omit<T, "_id">>): Promise<void>
  stop(): void
}


export type ObserveChangesObserver<ID extends Stringable, T> = Required<
  UnorderedObserveChangesCallbacks<ID, T>
  & OrderedObserveChangesCallbacks<ID, T>
  & SharedObserveChangesCallbacks<ID, T>
> & {
  observes(hookName: keyof ObserveChangesCallbacks<ID, T>): boolean
  // flush(downstream?: boolean): Promise<void>
}

export type CachingChangeObserverOptions = {
  ordered: boolean;
  cloneDocuments?: boolean;
  clone?: Clone;
}

export type CachingChangeObserver<ID extends Stringable, T extends StringObjectWithoutID> = ObserveChangesObserver<ID, T> & {
  forEach(iterator: (doc: T, id: ID) => void): void;
  indexOf(id: ID): number;
  size(): number;
  get(id: ID): T | undefined;
  getDocs() : OrderedDict<ID, T> | StringableIdMap<ID, T>;
}
