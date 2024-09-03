import { SubscriptionManager } from "./manager.js";

let subManager: SubscriptionManager | undefined;


export function getSubManager() {
  return subManager;
}

export function setSubManager(newSubManager: SubscriptionManager) {
  subManager = newSubManager;
}
