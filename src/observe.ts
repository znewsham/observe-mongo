import type { Collection, FindCursor } from "mongodb";
import { MinimalCollection, ObserveCallbacks, ObserveChangesCallbacks, ObserveDriver, ObserveHandle, ObserveMultiplexerInterface, ObserveOptions, Observer, Stringable, naiveClone } from "./types.js";
import { ObserveMultiplexer } from "./multiplexer.js";
import { ObserveHandleImpl } from "./handle.js";
import { PollingDriver } from "./pollingDriver.js";
import { CachingChangeObserverImpl } from "./cachingChangeObserver.js";
import { applyChanges } from "./diff.js";


export const observerMultiplexers = new Map<string, ObserveMultiplexer<Stringable>>();

let nextMultiplexerId = 1;

export async function observeChanges<T extends { _id: Stringable }>(
  cursor: FindCursor<T>,
  collection: MinimalCollection<{ _id?: Stringable }>,
  callbacks: ObserveChangesCallbacks<T>,
  options: Omit<ObserveOptions<T>, "transform"> = {}
) : Promise<ObserveHandle> {
  const {
    ordered = observeChangesCallbacksAreOrdered(callbacks),
    nonMutatingCallbacks = true,
    driverClass = PollingDriver,
    multiplexerId = (cursor: FindCursor<T>, collection: MinimalCollection<{ _id?: Stringable }>, options: ObserveOptions<T>) => `${nextMultiplexerId++}`,
  } = options;

  const id = multiplexerId(cursor, collection, options);

  const existingMultiplexer = observerMultiplexers.get(id);
  let multiplexer: ObserveMultiplexer<T["_id"], T>;
  let driver: ObserveDriver<T> | undefined;
  if (existingMultiplexer) {
    multiplexer = existingMultiplexer as unknown as ObserveMultiplexer<T["_id"], T>;
  }
  else {
    if (!driverClass) {
      throw new Error("Invalid driverClass");
    }
    driver = new driverClass(cursor, collection, {
      ...options,
      ordered
    });
    multiplexer = new ObserveMultiplexer({
      ordered: ordered || false,
      onStop() {
        observerMultiplexers.delete(id);
        if (driver) {
          driver.stop();
        }
      }
    });
  }

  observerMultiplexers.set(id, multiplexer as unknown as ObserveMultiplexer<Stringable>);

  const handle = new ObserveHandleImpl(
    multiplexer,
    callbacks,
    nonMutatingCallbacks,
    options.clone
  );

  const initialSendAddsPromise = multiplexer.addHandleAndSendInitialAdds(handle);
  if (driver) {
    await driver.init(multiplexer);
  }
  await initialSendAddsPromise;
  return handle;
}

function observeChangesCallbacksFromObserveCallbacks<T extends { _id: Stringable }>(
  observeCallbacks: ObserveCallbacks<T>,
  {
    clone = naiveClone,
    ordered = observeCallbacksAreOrdered(observeCallbacks),
    transform: _transform
  }: ObserveOptions<T> = {}
): { observeChangesCallbacks: ObserveChangesCallbacks<Omit<T, "_id">>, setSuppressed(suppressed: boolean): void } {
  const transform = _transform || ((doc:any) => doc);
  let suppressed = !!observeCallbacks._suppress_initial;

  const cache = new CachingChangeObserverImpl({
    ordered
  });

  let observeChangesCallbacks: ObserveChangesCallbacks<Omit<T, "_id">>;
  if (ordered) {
    // The "_no_indices" option sets all index arguments to -1 and skips the
    // linear scans required to generate them.  This lets observers that don't
    // need absolute indices benefit from the other features of this API --
    // relative order, transforms, and applyChanges -- without the speed hit.
    const indices = !observeCallbacks._no_indices;

    observeChangesCallbacks = {
      addedBefore(id, fields, before) {
        if (suppressed) {
          return;
        }
        cache.addedBefore(id, { _id: id, ...fields }, before);
        if (!(observeCallbacks.addedAt || observeCallbacks.added)) {
          return;
        }

        const doc = transform(clone({ _id: id, ...fields }));

        if (observeCallbacks.addedAt) {
          observeCallbacks.addedAt(
            doc,
            indices
              ? before
                ? cache.indexOf(before)
                : cache.size()
              : -1,
            before
          );
        }
        else if (observeCallbacks.added) {
          observeCallbacks.added(doc);
        }
      },
      changed(id, fields) {
        if (!(observeCallbacks.changedAt || observeCallbacks.changed)) {
          return;
        }

        let doc = clone(cache.get(id));
        if (!doc) {
          throw new Error(`Unknown id for changed: ${id}`);
        }

        const cloned = clone(doc);
        const oldDoc = transform(cloned);

        applyChanges(doc, fields);

        if (observeCallbacks.changedAt) {
          observeCallbacks.changedAt(
            transform(doc),
            oldDoc,
            indices ? cache.indexOf(id) : -1
          );
        }
        else if (observeCallbacks.changed) {
          observeCallbacks.changed(transform(doc), oldDoc);
        }
      },
      movedBefore(id, before) {
        if (!observeCallbacks.movedTo) {
          return;
        }

        const from = indices ? cache.indexOf(id) : -1;
        let to = indices
          ? before
            ? cache.indexOf(before)
            : cache.size()
          : -1;
        cache.movedBefore(id, before);

        // When not moving backwards, adjust for the fact that removing the
        // document slides everything back one slot.
        if (to > from) {
          --to;
        }

        observeCallbacks.movedTo(
          transform(clone(cache.get(id))),
          from,
          to,
          before
        );
      },
      removed(id) {
        if (!(observeCallbacks.removedAt || observeCallbacks.removed)) {
          return;
        }

        // technically maybe there should be an EJSON.clone here, but it's about
        // to be removed from this.docs!
        const doc = transform(cache.get(id));
        const index = indices && observeCallbacks.removedAt ? cache.indexOf(id) : -1;
        cache.removed(id);

        if (observeCallbacks.removedAt) {
          observeCallbacks.removedAt(doc, index);
        }
        else if (observeCallbacks.removed) {
          observeCallbacks.removed(doc);
        }
      },
    };
  } else {
    observeChangesCallbacks = {
      added(id, fields) {
        if (suppressed) {
          return;
        }
        cache.added(id, { _id: id, ...fields });
        if (observeCallbacks.added) {
          observeCallbacks.added(transform({ ...fields, _id: id }));
        }
      },
      changed(id, fields) {
        if (observeCallbacks.changed) {
          const oldDoc = cache.get(id);
          cache.changed(id, fields);
          if (!oldDoc) {
            throw new Error(`Unknown id for changed: ${id}`);
          }
          const doc = clone(oldDoc);

          applyChanges(doc, fields);

          observeCallbacks.changed(
            transform(doc),
            transform(clone(oldDoc))
          );
        }
      },
      removed(id) {
        if (observeCallbacks.removed) {
          const doc = cache.get(id);
          cache.removed(id);
          observeCallbacks.removed(transform(doc));
        }
      },
    };
  }
  return {
    observeChangesCallbacks: observeChangesCallbacks,
    setSuppressed: (_suppressed) => suppressed = _suppressed
  };
}

export async function observe<T extends { _id: Stringable }>(
  cursor: FindCursor<T>,
  collection: MinimalCollection<{ _id?: Stringable }>,
  observeCallbacks: ObserveCallbacks<T>,
  options: ObserveOptions<T> = {}
): Promise<ObserveHandle> {
  const { setSuppressed, observeChangesCallbacks } = observeChangesCallbacksFromObserveCallbacks(
    observeCallbacks,
    options
  );

  const handle = await observeChanges(
    cursor,
    collection,
    observeChangesCallbacks,
    options
  );
  setSuppressed(false);
  return handle;
}

export async function observeFromObserveChanges<T extends { _id: Stringable }>(
  observeCallbacks: ObserveCallbacks<T>,
  observer: Observer<T>,
  options: ObserveOptions<T> = {}
): Promise<ObserveHandle> {
  const { setSuppressed, observeChangesCallbacks } = observeChangesCallbacksFromObserveCallbacks(
    observeCallbacks,
    options
  )
  const handle = await observer.observeChanges(
      observeChangesCallbacks,
      { ...options, nonMutatingCallbacks: true }
    );
    setSuppressed(false);

  return handle;
}


export function observeCallbacksAreOrdered<T>(callbacks: ObserveCallbacks<T>) {
  if (callbacks.added && callbacks.addedAt) {
    throw new Error('Please specify only one of added() and addedAt()');
  }

  if (callbacks.changed && callbacks.changedAt) {
    throw new Error('Please specify only one of changed() and changedAt()');
  }

  if (callbacks.removed && callbacks.removedAt) {
    throw new Error('Please specify only one of removed() and removedAt()');
  }

  return !!(
    callbacks.addedAt ||
    callbacks.changedAt ||
    callbacks.movedTo ||
    callbacks.removedAt
  );
};

export function observeChangesCallbacksAreOrdered<T>(callbacks: ObserveChangesCallbacks<T>) {
  if (callbacks.added && callbacks.addedBefore) {
    throw new Error('Please specify only one of added() and addedBefore()');
  }

  return !!(callbacks.addedBefore || callbacks.movedBefore);
};
