# observe-mongo
This package allows creating meteor like observers of the form: `Collection.find().observe({...})`, without all the "meteor". It's primarily used by the `znewsham:mongo-collection-hooks` meteor package to ensure compatibility with meteor. As such, this is not the easiest to use as a standalone package, but it's very configurable.


## Basic usage
```typescript
import { observeChanges } from "observe-mongo";

async function observe() {
  const handle = await observeChanges(
    collection.find({}),
    collection,
    {
      added() {

      },
      removed() {

      }
    }
  );

  const handle2 = await observe(
    collection.find({}),
    collection,
    {
      added() {

      },
      removed() {

      }
    }
  );
}
```

## Requirements
The key requirement of this package is the cursor requires a `cursorDescription` of this shape:

```typescript
type CursorDescription<T> = {
  filter?: Filter<T>;
  options: {
      skip?: number;
      limit?: number;
      sort?: [string, 1 | -1][] | {
          [k in string]: 1 | -1;
      };
      projection?: T extends object ? NestedProjectionOfTSchema<T> : never;
  }
};
```

The easiest way to do this would be to add it to the cursor

```typescript
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URL).db().collection("collectionName");

const origFind = client.find;

client.find = function(filter, options) {
  const cursor = origFind.call(filter, options);
  cursor.cursorDescription = {
    filter,
    options: {
      skip: options?.skip,
      limit: options?.limit,
      sort: options?.sort,
      projection: options?.projection
    }
  }
}
```


## Detailed Options
The third option to `observe` and `observeChanges` is the following shape:

```typescript
type ObserveOptions<T extends { _id: Stringable }> = {
  ordered?: boolean,
  clone?: Clone,
  equals?: Equals,
  transform?: <T>(doc: T) => T,
  driverClass?: ObserveDriverConstructor<T>
  multiplexerId?: (cursor: FindCursor<T>, collection: MinimalCollection<{ _id?: Stringable }>, options: ObserveOptions<T>) => string
};
```

The observer should work with any schema with an `_id` of almost any shape, `string`, `number`, `ObjectId`, `Date` or an array or object of any of the above.

The options are as follows:
- `ordered` - whether or not the callbacks are "ordered", by default this will be determined by the callbacks provided.
- `clone` - an implementation of clone, defaults to `JSON.parse(JSON.stringify(...))` - but this could be `EJSON`
- `equals` - as with `clone`
- `transform` - an arbitrary transformation, likely the one on the cursor itself.
- `driverClass` - by default you get a polling driver - but there's one available that's compatible with redis-oplog.
- `multiplexerId` - Like Meteor, we'll reuse the multiplexer to reduce memory usage, this defaults to a random ID, but it can be configured to dedupe based on the cursor description.


### Redis-oplog
What follows is an example configuration to call `observeChanges` using redis-oplog.

```typescript
import { Minimongo } from "meteor/minimongo";
import { EJSON } from "meteor/ejson";
import { Config } from "meteor/cultofcoders:redis-oplog";
import { RedisObserverDriver } from "observe-mongo/redis";

// the subscriptionManager *should* be unique (to avoid duplicate lookups)
// the pubSubManager need only expose `subscribe` and `unsubscribe` - it doesn't actually need the redis-oplog package at all.
const subscriptionManager = new SubscriptionManager(Config.pubSubManager)
function observeChangesWithRedisOplog(
  cursor: FindCursorWithDescription<ObserveSchema>,
  collection: Collection,
) {

  return observeChanges(
    cursor,
    collection,
    callbacks,
    {
      clone: EJSON.clone,
      equals: (doc1: ObserveSchema, doc2: ObserveSchema) => EJSON.equals(doc1, doc2),
      multiplexerId: () => EJSON.stringify({
        namespace: collection.namespace,
        ...cursor.cursorDescription
      }),
      Matcher: Minimongo.Matcher,
      Sorter: Minimongo.Sorter,
      compileProjection: Minimongo.LocalCollection._compileProjection,
      driverClass: RedisObserverDriver,
      manager: subscriptionManager
    }
  );
}
```

The three minimongo dependencies are really the only pieces that require meteor at all - and technically those are all available outside of meteor with `@blastjs/minimongo`.

optimistic UI can be achieved by directly calling `subscriptionManager.process` - any observers created using this code will observe all the regular redis traffic from redis-oplog, but won't partake in the optimistic UI.
