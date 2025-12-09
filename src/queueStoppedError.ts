export class QueueStoppedError extends Error {
  isQueueStoppedError = true;
  constructor(message: string = "This queue has been stopped") {
    super(message);
    this.name = "QueueStoppedError";
  }
}
