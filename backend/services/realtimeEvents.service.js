const { EventEmitter } = require("node:events");
const { AsyncLocalStorage } = require("node:async_hooks");

const realtimeEvents = new EventEmitter();
realtimeEvents.setMaxListeners(20);
const deferredEvents = new AsyncLocalStorage();
const emit = realtimeEvents.emit.bind(realtimeEvents);
realtimeEvents.emit = (name, ...args) => {
  const pending = deferredEvents.getStore();
  if (!pending) return emit(name, ...args);
  pending.push([name, ...structuredClone(args)]);
  return realtimeEvents.listenerCount(name) > 0;
};

realtimeEvents.withDeferredEvents = async (callback) => {
  if (deferredEvents.getStore()) return callback();
  const pending = [];
  const result = await deferredEvents.run(pending, callback);
  for (const [name, ...args] of pending) emit(name, ...args);
  return result;
};

module.exports = realtimeEvents;
