const crypto = require("node:crypto");
const { readDatabase, writeSelectedRecords } = require("./core.service");
const copilotConversationsRepository = require("../repositories/copilotConversations.repository");
const copilotMessagesRepository = require("../repositories/copilotMessages.repository");
const { getDatabaseMode } = require("./postgres.service");

const TTL_MS = Math.max(60_000, Number(process.env.COPILOT_CONVERSATION_TTL_MS || 30 * 60 * 1000));
const ID_PATTERN = /^[a-f0-9-]{36}$/i;
const MAX_EXCHANGES = 50;
const MAX_MESSAGES = MAX_EXCHANGES * 2;

function enforceMessageLimit(messages) {
  if (messages.length > MAX_MESSAGES) {
    return messages.slice(-MAX_MESSAGES);
  }
  return messages;
}

async function saveConversationToDb(conversation, messages) {
  const limitedMessages = enforceMessageLimit(messages);
  if (getDatabaseMode() === "json") {
    const { readDb, writeDb } = require("./core.service");
    const db = readDb();
    const existingConvIndex = db.copilotConversations?.findIndex(c => c.id === conversation.id) ?? -1;
    const convData = {
      id: conversation.id,
      userId: conversation.userId,
      entities: conversation.entities,
      language: conversation.language,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    };
    if (existingConvIndex >= 0) {
      db.copilotConversations[existingConvIndex] = convData;
    } else {
      db.copilotConversations = db.copilotConversations || [];
      db.copilotConversations.push(convData);
    }
    const existingMsgIds = new Set((db.copilotMessages || []).map(m => m.id));
    for (const msg of limitedMessages) {
      if (!existingMsgIds.has(msg.id)) {
        db.copilotMessages = db.copilotMessages || [];
        db.copilotMessages.push(msg);
      }
    }
    db.copilotMessages = enforceMessageLimit(db.copilotMessages.filter(m => m.conversationId === conversation.id));
    writeDb(db);
    return;
  }
  const db = await readDatabase();
  await writeSelectedRecords(
    db,
    [
      [copilotConversationsRepository, [conversation]],
      [copilotMessagesRepository, limitedMessages]
    ]
  );
}

async function deleteConversationFromDb(conversationId) {
  if (getDatabaseMode() === "json") {
    const { readDb, writeDb } = require("./core.service");
    const db = readDb();
    db.copilotConversations = (db.copilotConversations || []).filter(c => c.id !== conversationId);
    db.copilotMessages = (db.copilotMessages || []).filter(m => m.conversationId !== conversationId);
    writeDb(db);
    return;
  }
  const { query } = require("./postgres.service");
  await query("DELETE FROM copilot_messages WHERE conversation_id = $1", [conversationId]);
  await query("DELETE FROM copilot_conversations WHERE id = $1", [conversationId]);
}

async function loadUserConversations(userId) {
  if (getDatabaseMode() === "json") {
    const { readDb } = require("./core.service");
    const db = readDb();
    const conversations = (db.copilotConversations || []).filter(c => c.userId === userId);
    const messages = (db.copilotMessages || []).filter(m =>
      conversations.some(c => c.id === m.conversationId)
    );
    return { conversations, messages };
  }
  const { query } = require("./postgres.service");
  const convResult = await query(
    "SELECT * FROM copilot_conversations WHERE user_id = $1 ORDER BY updated_at DESC",
    [userId]
  );
  const conversations = convResult.rows;
  if (!conversations.length) return { conversations: [], messages: [] };
  const convIds = conversations.map(c => c.id);
  const msgResult = await query(
    `SELECT * FROM copilot_messages WHERE conversation_id = ANY($1::text[]) ORDER BY created_at ASC`,
    [convIds]
  );
  return { conversations, messages: msgResult.rows };
}

function buildConversationState(conversations, messages) {
  const state = new Map();
  for (const conv of conversations) {
    const convMessages = messages.filter(m => m.conversationId === conv.id);
    const entities = conv.entities || [];
    const language = conv.language || "en";
    state.set(`${conv.userId}:${conv.id}`, {
      conversationId: conv.id,
      userId: conv.userId,
      entities,
      language,
      messages: convMessages,
      updatedAt: Date.parse(conv.updatedAt || conv.updated_at)
    });
  }
  return state;
}

let conversationCache = new Map();
let cacheLoaded = false;

async function ensureCacheLoaded(userId) {
  if (cacheLoaded) return;
  if (getDatabaseMode() !== "json") {
    cacheLoaded = true;
    return;
  }
  const { conversations, messages } = await loadUserConversations(userId);
  conversationCache = buildConversationState(conversations, messages);
  cacheLoaded = true;
}

async function open(userId, suppliedId) {
  await ensureCacheLoaded(userId);
  const now = Date.now();
  const conversationId = ID_PATTERN.test(String(suppliedId || "")) ? String(suppliedId) : crypto.randomUUID();
  const key = `${userId}:${conversationId}`;
  let state = conversationCache.get(key);
  
  if (!state) {
    if (getDatabaseMode() === "json") {
      const { readDb } = require("./core.service");
      const db = readDb();
      const conv = (db.copilotConversations || []).find(c => c.id === conversationId && c.userId === userId);
      if (conv) {
        const messages = (db.copilotMessages || []).filter(m => m.conversationId === conversationId);
        state = {
          conversationId: conv.id,
          userId: conv.userId,
          entities: conv.entities || [],
          language: conv.language || "en",
          messages,
          updatedAt: Date.parse(conv.updatedAt)
        };
        conversationCache.set(key, state);
      }
    } else {
      const { query } = require("./postgres.service");
      const convResult = await query(
        "SELECT * FROM copilot_conversations WHERE id = $1 AND user_id = $2",
        [conversationId, userId]
      );
      if (convResult.rows.length) {
        const conv = convResult.rows[0];
        const msgResult = await query(
          "SELECT * FROM copilot_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
          [conversationId]
        );
        state = {
          conversationId: conv.id,
          userId: conv.user_id,
          entities: conv.entities || [],
          language: conv.language || "en",
          messages: msgResult.rows,
          updatedAt: Date.parse(conv.updated_at)
        };
        conversationCache.set(key, state);
      }
    }
  }
  
  if (!state) {
    state = {
      conversationId,
      userId,
      entities: [],
      language: "en",
      messages: [],
      updatedAt: now
    };
    conversationCache.set(key, state);
  }
  
  return {
    conversationId: state.conversationId,
    entities: state.entities,
    language: state.language,
    key,
    messages: state.messages
  };
}

async function remember(key, entities, language) {
  const [userId, conversationId] = key.split(":");
  const now = Date.now();
  const state = conversationCache.get(key) || {
    conversationId,
    userId,
    entities: [],
    language: "en",
    messages: [],
    updatedAt: now
  };
  
  state.entities = Array.isArray(entities) ? entities.slice(0, 8) : [];
  state.language = ["en", "te", "hi"].includes(language) ? language : "en";
  state.updatedAt = now;
  conversationCache.set(key, state);
  
  const conversation = {
    id: conversationId,
    userId,
    entities: state.entities,
    language: state.language,
    createdAt: state.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  };
  
  await saveConversationToDb(conversation, state.messages);
}

async function appendMessage(key, role, content, metadata = {}) {
  const state = conversationCache.get(key);
  if (!state) return;
  
  const messageId = crypto.randomUUID();
  const message = {
    id: messageId,
    conversationId: state.conversationId,
    role,
    content,
    metadata,
    createdAt: new Date().toISOString()
  };
  
  state.messages.push(message);
  state.messages = enforceMessageLimit(state.messages);
  state.updatedAt = Date.now();
  conversationCache.set(key, state);
  
  const conversation = {
    id: state.conversationId,
    userId: state.userId,
    entities: state.entities,
    language: state.language,
    createdAt: state.createdAt || new Date(state.updatedAt).toISOString(),
    updatedAt: new Date(state.updatedAt).toISOString()
  };
  
  await saveConversationToDb(conversation, state.messages);
}

async function getMessages(key) {
  const state = conversationCache.get(key);
  return state?.messages || [];
}

async function clearUserConversations(userId) {
  if (getDatabaseMode() === "json") {
    const { readDb, writeDb } = require("./core.service");
    const db = readDb();
    const userConvIds = (db.copilotConversations || [])
      .filter(c => c.userId === userId)
      .map(c => c.id);
    db.copilotConversations = (db.copilotConversations || []).filter(c => c.userId !== userId);
    db.copilotMessages = (db.copilotMessages || []).filter(m => !userConvIds.includes(m.conversationId));
    writeDb(db);
    for (const key of conversationCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        conversationCache.delete(key);
      }
    }
    return;
  }
  const { query } = require("./postgres.service");
  const convResult = await query("SELECT id FROM copilot_conversations WHERE user_id = $1", [userId]);
  const convIds = convResult.rows.map(r => r.id);
  if (convIds.length) {
    await query("DELETE FROM copilot_messages WHERE conversation_id = ANY($1::text[])", [convIds]);
    await query("DELETE FROM copilot_conversations WHERE user_id = $1", [userId]);
  }
  for (const key of conversationCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      conversationCache.delete(key);
    }
  }
}

function clear() {
  conversationCache.clear();
  cacheLoaded = false;
}

module.exports = {
  open,
  remember,
  appendMessage,
  getMessages,
  clearUserConversations,
  clear,
  TTL_MS,
  MAX_EXCHANGES,
  MAX_MESSAGES
};