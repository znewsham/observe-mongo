export class AsyncResource {
  #name;
  constructor(name: string) {
    this.#name = name;
  }
  runInAsyncScope(fn: Function, thisArg: any, ...args: any[]) {
    return fn.call(thisArg, ...args);
  }
};
