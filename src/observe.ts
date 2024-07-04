import type { Collection, FindCursor } from "mongodb";
import { MinimalCollection, ObserveCallbacks, ObserveChangesCallbacks, ObserveChangesMutatingCallbacks, ObserveChangesNonMutatingCallbacks, ObserveDriver, ObserveHandle, ObserveMultiplexerInterface, ObserveOnlyOptions, ObserveOptions, Observer, Stringable, naiveClone } from "./types.js";
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
  callbacks: ObserveChangesNonMutatingCallbacks<T["_id"], Omit<T, "_id">>,
  options: { nonMutatingCallbacks: true } & Omit<ObserveOptions<T>, "transform">
): Promise<ObserveHandle>
export async function observeChanges<T extends { _id: Stringable }>(
  cursor: FindCursor<T>,
  collection: MinimalCollection<{ _id?: Stringable }>,
  callbacks: ObserveChangesMutatingCallbacks<T["_id"], Omit<T, "_id">>,
  options: { nonMutatingCallbacks: false } & Omit<ObserveOptions<T>, "transform">
): Promise<ObserveHandle>
export async function observeChanges<T extends { _id: Stringable }>(
  cursor: FindCursor<T>,
  collection: MinimalCollection<{ _id?: Stringable }>,
  callbacks: ObserveChangesMutatingCallbacks<T["_id"], Omit<T, "_id">>,
  options: Omit<ObserveOptions<T>, "transform">
): Promise<ObserveHandle>
export async function observeChanges<T extends { _id: Stringable }>(
  cursor: FindCursor<T>,
  collection: MinimalCollection<{ _id?: Stringable }>,
  callbacks: ObserveChangesCallbacks<T["_id"], Omit<T, "_id">>,
  options: Omit<ObserveOptions<T>, "transform" | "ordered"> = {}
): Promise<ObserveHandle> {
  const {
    nonMutatingCallbacks = true,
    driverClass = PollingDriver,
    multiplexerId = (cursor: FindCursor<T>, collection: MinimalCollection<{ _id?: Stringable }>, options: ObserveOptions<T>) => `${nextMultiplexerId++}`,
  } = options;
  const ordered = observeChangesCallbacksAreOrdered(callbacks);

  const id = multiplexerId(cursor, collection, { ordered, ...options });

  const existingMultiplexer = observerMultiplexers.get(id);
  let multiplexer: ObserveMultiplexer<T["_id"], Omit<T, "_id">>;
  let driver: ObserveDriver<T> | undefined;
  if (existingMultiplexer) {
    multiplexer = existingMultiplexer as unknown as ObserveMultiplexer<T["_id"], Omit<T, "_id">>;
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

  observerMultiplexers.set(id, multiplexer as unknown as ObserveMultiplexer<T["_id"]>);

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
    clone: _clone = naiveClone,
    transform: _transform,
    nonMutatingCallbacks,
    noIndices,
    suppressInitial
  }: Omit<ObserveOptions<T> & ObserveOnlyOptions, "ordered"> = {}
): { observeChangesCallbacks: ObserveChangesCallbacks<T["_id"], Omit<T, "_id">>, setSuppressed(suppressed: boolean): void } {
  const transform = _transform || ((doc:any) => doc);
  let suppressed = suppressInitial;
  const ordered = observeCallbacksAreOrdered(observeCallbacks);
  const cache = new CachingChangeObserverImpl({
    ordered
  });

  const cloneIfMutating = nonMutatingCallbacks ? <X>(doc: X) => doc : _clone;


  let observeChangesCallbacks: ObserveChangesNonMutatingCallbacks<T["_id"], Omit<T, "_id">>;
  if (ordered) {
    const indices = !noIndices;

    observeChangesCallbacks = {
      addedBefore(id, fields, before) {
        if (suppressed) {
          return;
        }
        cache.addedBefore(id, { _id: id, ...fields }, before);
        if (!(observeCallbacks.addedAt || observeCallbacks.added)) {
          return;
        }

        const doc = transform(cloneIfMutating({ _id: id, ...fields }));

        const beforeDoc = before && transform(cloneIfMutating(cache.get(before)));

        if (observeCallbacks.addedAt) {
          observeCallbacks.addedAt(
            doc,
            indices
              ? before
                ? cache.indexOf(before)
                : cache.size()
              : -1,
            beforeDoc
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

        let doc = cloneIfMutating(cache.get(id));
        if (!doc) {
          throw new Error(`Unknown id for changed: ${id}`);
        }

        const cloned = cloneIfMutating(doc);
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
        const beforeDoc = before && transform(cloneIfMutating(cache.get(before)));

        // When not moving backwards, adjust for the fact that removing the
        // document slides everything back one slot.
        if (to > from) {
          --to;
        }

        observeCallbacks.movedTo(
          transform(cloneIfMutating(cache.get(id))),
          from,
          to,
          beforeDoc
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
          const doc = cloneIfMutating(oldDoc);

          applyChanges(doc, fields);

          observeCallbacks.changed(
            transform(doc),
            transform(cloneIfMutating(oldDoc))
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
  options: Omit<ObserveOptions<T> & ObserveOnlyOptions, "ordered"> = {}
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
  options: Omit<ObserveOptions<T>, "ordered"> = {}
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


export function observeCallbacksAreOrdered<T extends { _id: Stringable }>(callbacks: ObserveCallbacks<T>) {
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

export function observeChangesCallbacksAreOrdered<T extends { _id: Stringable }>(callbacks: ObserveChangesCallbacks<T["_id"], Omit<T, "_id">>) {
  if (callbacks.added && callbacks.addedBefore) {
    throw new Error('Please specify only one of added() and addedBefore()');
  }

  return !!(callbacks.addedBefore || callbacks.movedBefore);
};
