const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const config = require('./project.config');
const PORT = process.env.PORT || config.port || 3900;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function readDb() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2) + '\n');
}

function stamp(action, note) {
  return {
    at: new Date().toISOString(),
    action,
    note: note || ''
  };
}

function sortNewest(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
}

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/db', async (req, res) => {
  const db = await readDb();
  for (const key of Object.keys(db)) {
    if (Array.isArray(db[key])) db[key].sort(sortNewest);
  }
  res.json(db);
});

app.post('/api/:collection', async (req, res) => {
  const db = await readDb();
  const { collection } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const now = new Date().toISOString();
  const item = {
    id: `${collection}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    ...req.body,
    createdAt: now,
    updatedAt: now,
    history: [stamp('创建', req.body.note || req.body.memo || '')]
  };
  db[collection].push(item);
  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const historyAction = req.body.historyAction;
  delete req.body.historyAction;
  Object.assign(item, req.body, { updatedAt: new Date().toISOString() });
  item.history = item.history || [];
  if (historyAction || req.body.note || req.body.memo || req.body.status) {
    item.history.unshift(stamp(historyAction || req.body.status || '更新', req.body.note || req.body.memo || ''));
  }
  await writeDb(db);
  res.json(item);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const before = db[collection].length;
  db[collection] = db[collection].filter((entry) => entry.id !== id);
  if (db[collection].length === before) return res.status(404).json({ error: 'not found' });
  await writeDb(db);
  res.status(204).end();
});

app.post('/api/action/:actionId/:id', async (req, res) => {
  const db = await readDb();
  const action = config.actions.find((entry) => entry.id === req.params.actionId);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  const item = db[action.collection]?.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const body = { ...(req.body || {}) };
  for (const field of action.form || []) {
    const raw = body[field.name];
    if (field.required && (raw === undefined || raw === null || raw === '')) {
      return res.status(400).json({ error: `请填写${field.label}` });
    }
    if (field.type === 'number' && raw !== undefined && raw !== '') {
      body[field.name] = Number(raw);
      if (Number.isNaN(body[field.name])) return res.status(400).json({ error: `${field.label}需为数字` });
    }
  }
  const result = runAction(db, action, item, body);
  if (result.error) return res.status(409).json({ error: result.error });
  await writeDb(db);
  res.json({ item: result.item, note: result.note || '' });
});

function getValue(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function setValue(target, pathName, value) {
  const keys = pathName.split('.');
  let cursor = target;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
}

function findRelated(db, relation, item) {
  return db[relation.collection]?.find((entry) => entry.id === item[relation.localKey]);
}

const levelRank = { '低': 1, '中': 2, '高': 3 };

function conditionRight(context, cond) {
  const base = cond.rightPath ? getValue(context, cond.rightPath) : cond.right;
  return cond.margin === undefined ? base : Number(base) + Number(cond.margin);
}

function testCondition(context, cond) {
  const left = getValue(context, cond.left);
  const right = conditionRight(context, cond);
  switch (cond.op) {
    case 'missing': return Boolean(left);
    case 'eq': return left === right;
    case 'neq': return left !== right;
    case 'gte': return Number(left) >= Number(right);
    case 'lte': return Number(left) <= Number(right);
    case 'gt': return Number(left) > Number(right);
    case 'lt': return Number(left) < Number(right);
    case 'levelGte': return (levelRank[left] || 0) >= (levelRank[right] || 0);
    case 'notIn': return !cond.values.includes(left);
    default: return true;
  }
}

function runAction(db, action, item, body = {}) {
  const related = action.relation ? findRelated(db, action.relation, item) : null;
  const context = { item, related, body };
  for (const guard of action.guards || []) {
    if (!testCondition(context, guard)) return { error: guard.message };
  }
  const branch = (action.branches || []).find((entry) => (entry.when || []).every((cond) => testCondition(context, cond)));
  const note = branch?.note || action.note || '';
  const patches = [...(action.patches || []), ...(branch?.patches || [])];
  const touched = new Map();
  const markTouched = (target, noteText) => {
    if (target && !touched.has(target)) touched.set(target, noteText);
  };
  for (const patch of patches) {
    const target = patch.target === 'related' ? related : item;
    if (!target) continue;
    const next = patch.valuePath ? getValue(context, patch.valuePath) : patch.value;
    setValue(target, patch.field, next);
    markTouched(target, note || '状态流转');
  }
  for (const delta of action.deltas || []) {
    const target = delta.target === 'related' ? related : item;
    if (!target) continue;
    const sourceAmount = delta.amountPath ? Number(getValue(context, delta.amountPath)) : 1;
    const multiplier = delta.amount === undefined ? 1 : Number(delta.amount);
    const amount = sourceAmount * multiplier;
    const current = Number(getValue({ target }, `target.${delta.field}`) || 0);
    setValue(target, delta.field, current + amount);
    markTouched(target, note || '数量调整');
  }
  const now = new Date().toISOString();
  for (const [target, noteText] of touched) {
    target.updatedAt = now;
    target.history = target.history || [];
    target.history.unshift(stamp(action.label, noteText));
  }
  return { item, note };
}

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
