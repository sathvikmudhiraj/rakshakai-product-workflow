const { EventEmitter } = require("node:events");

const realtimeEvents = new EventEmitter();
realtimeEvents.setMaxListeners(20);

module.exports = realtimeEvents;
