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
  | { toHexString() : string } // this is a proxy for ObjectId - see above.
  | Date
  | number
  | { [k in string]: Stringable }
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
  // @ts-expect-error
  if (stringable._bsontype === "ObjectId") {
    return { $type: "oid", $value: stringable.toString() };
  }
  if (Array.isArray(stringable)) {
    return stringable.map(s => jsonable(s));
  }
  return Object.fromEntries(Object.entries(stringable).map(([key, value]) => [key, jsonable(value)]));
}
// a poor mans EJSON. Maybe just suck it up and pull it in as a dependency
export function stringId(stringable: Stringable): string {
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
      return new globalThis.ObjectId(json.$value);
    }
    throw new Error(`Invalid $type: ${json.$type}`);
  }
  if (Array.isArray(json)) {
    return json.map(value => typeof value === "object" ? jsonToObject(value) : value);
  }
  return Object.fromEntries(Object.entries(json).map(([key, value]) => [key, typeof value === "object" ? jsonToObject(value) : value])) as { [k in string]: Stringable };
}

export function fromStringId(id: string): Stringable {
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

export type ObserveOptions<T extends { _id: Stringable }> = {
  ordered?: boolean,
  nonMutatingCallbacks?: boolean,
  clone?: Clone,
  equals?: Equals,
  transform?: <T>(doc: T) => T,
  driverClass?: ObserveDriverConstructor<T>
  multiplexerId?: (cursor: FindCursor<T>, collection: MinimalCollection<{ _id?: Stringable }>, options: ObserveOptions<T>) => string
};

export type MinimalCollection<T extends Document> = Pick<Collection<T>, "find" | "findOne">

export type OrderedObserveChangesCallbacks<ID extends Stringable, T> = {
  addedBefore?: (id: ID, doc: T, before: ID | undefined) => void;
  movedBefore?: (id: ID, before: ID | undefined) => void;
}

export type SharedObserveChangesCallbacks<ID extends Stringable, T> = {
  changed?: (id: ID, fields: Partial<T>) => void;
  removed?: (id: ID) => void;
}

export type UnorderedObserveChangesCallbacks<ID extends Stringable, T> = {
  added?:(id: ID, doc: T) => void;
}

export type OrderedObserveCallbacks<ID extends Stringable, T> = {
  addedAt?: (doc: T, index: number, before: ID | undefined) => void;
  changedAt?: (newDoc: T, oldDoc: T, index: number) => void;
  movedTo?: (doc: T, from: number, to: number, before: ID | undefined) => void;
  removedAt?: (doc: T, index: number) => void;
}

export type UnorderedObserveCallbacks<T> = {
  added?: (doc: T) => void;
  changed?: (newDoc: T, oldDoc: T) => void;
  removed?: (doc: T) => void;
}

export type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
export type XOR<T, U> = (T | U) extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U;

export type ObserveCallbacks<ID extends Stringable, T> = XOR<OrderedObserveCallbacks<ID, T>, UnorderedObserveCallbacks<{ _id: ID } & T>> & {
  _suppress_initial?: boolean;
  _no_indices?: boolean;
};

export type ObserveChangesCallbacks<ID extends Stringable, T> = XOR<(OrderedObserveChangesCallbacks<ID, T> & SharedObserveChangesCallbacks<ID, T>), (UnorderedObserveChangesCallbacks<ID, T> & SharedObserveChangesCallbacks<ID, T>)>;
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

export type CachingChangeObserver<ID extends Stringable, T extends StringObjectWithoutID> = ObserveChangesObserver<ID, T> & {
  forEach(iterator: (doc: T, id: ID) => void): void;
  indexOf(id: ID): number;
  size(): number;
  get(id: ID): T | undefined;
  getDocs() : OrderedDict<ID, T> | StringableIdMap<ID, T>;
}
