const crypto = require("node:crypto");
const conversations = new Map();
const TTL_MS = Math.max(60_000, Number(process.env.COPILOT_CONVERSATION_TTL_MS || 30 * 60 * 1000));
const ID_PATTERN = /^[a-f0-9-]{36}$/i;

function prune(now = Date.now()) { for (const [key, state] of conversations) if (now - state.updatedAt > TTL_MS) conversations.delete(key); }
function open(actorId, suppliedId) {
  prune();
  const conversationId = ID_PATTERN.test(String(suppliedId || "")) ? String(suppliedId) : crypto.randomUUID(), key = `${actorId}:${conversationId}`, state = conversations.get(key) || { entities: [], language: "en", updatedAt: Date.now() };
  return { conversationId, entities: state.entities, language: state.language || "en", key };
}
function remember(key, entities, language) { conversations.set(key, { entities: Array.isArray(entities) ? entities.slice(0, 8) : [], language: ["en", "te", "hi"].includes(language) ? language : "en", updatedAt: Date.now() }); }
function clear() { conversations.clear(); }
module.exports = { open, remember, clear, TTL_MS };
