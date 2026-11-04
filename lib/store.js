'use strict';

const crypto = require('crypto');

// In-memory session store for processed papers.
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_SESSIONS = 10;

const sessions = new Map();

function prune() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > TTL_MS) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    sessions.delete(oldest[0]);
  }
}

function create(data) {
  prune();
  const id = crypto.randomUUID();
  sessions.set(id, { id, createdAt: Date.now(), ...data });
  return id;
}

function get(id) {
  prune();
  return sessions.get(String(id || ''));
}

module.exports = { create, get };
