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
  const result = action.type === 'review'
    ? runReviewAction(db, action, item, req.body || {})
    : runAction(db, action, item);
  if (result.error) return res.status(result.status || 409).json({ error: result.error });
  await writeDb(db);
  res.json(result.item);
});

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function runReviewAction(db, action, item, body) {
  const limits = { tempDelta: 0.5, humidityDelta: 2, co2Delta: 50, ...(action.limits || {}) };
  if (item.status === '已复查') {
    return { error: '该记录已复查，不能重复登记', status: 409 };
  }
  if (item.status !== '异常待复查') {
    return { error: '仅异常待复查的记录可以登记复查', status: 409 };
  }
  const site = action.relation ? findRelated(db, action.relation, item) : null;
  if (!site) {
    return { error: '未找到关联样点，无法对照基准', status: 400 };
  }
  const reviewer = String(body.reviewer || '').trim();
  const reviewNote = String(body.reviewNote || '').trim();
  const reviewTemp = Number(body.reviewTemp);
  const reviewHumidity = Number(body.reviewHumidity);
  const reviewCo2 = Number(body.reviewCo2);
  if (!reviewer) return { error: '请填写复查人', status: 400 };
  if (!reviewNote) return { error: '请填写复查说明', status: 400 };
  if ([reviewTemp, reviewHumidity, reviewCo2].some((value) => !Number.isFinite(value))) {
    return { error: '请填写有效的复查温度、湿度和CO2', status: 400 };
  }

  const tempDelta = round2(reviewTemp - Number(site.baselineTemp));
  const humidityDelta = round2(reviewHumidity - Number(site.baselineHumidity));
  const co2Delta = round2(reviewCo2 - Number(site.baselineCo2));
  const tempFail = tempDelta > limits.tempDelta;
  const humidityFail = humidityDelta < -limits.humidityDelta;
  const co2Fail = co2Delta > limits.co2Delta;
  const passed = !tempFail && !humidityFail && !co2Fail;

  const failed = [];
  if (tempFail) failed.push(`温度偏高${tempDelta}℃`);
  if (humidityFail) failed.push(`湿度低${Math.abs(humidityDelta)}个百分点`);
  if (co2Fail) failed.push(`CO2偏高${co2Delta}ppm`);
  const conclusion = passed ? '复查达标' : '复查未达标';
  const conclusionNote = passed
    ? `复查达标，结束异常并恢复常规观察（温度${formatSigned(tempDelta)}℃ / 湿度${formatSigned(humidityDelta)}pp / CO2${formatSigned(co2Delta)}ppm）`
    : `复查未达标，保留重点保护：${failed.join('、')}（温度${formatSigned(tempDelta)}℃ / 湿度${formatSigned(humidityDelta)}pp / CO2${formatSigned(co2Delta)}ppm）`;

  const now = new Date().toISOString();
  Object.assign(item, {
    reviewer,
    reviewTemp,
    reviewHumidity,
    reviewCo2,
    reviewNote,
    reviewConclusion: conclusion,
    reviewedAt: now,
    status: passed ? '已复查' : '异常待复查',
    updatedAt: now
  });
  item.history = item.history || [];
  item.history.unshift(stamp('复查登记', conclusionNote));

  if (passed) {
    site.protectedStatus = '常规观察';
  } else if (!site.protectedStatus || site.protectedStatus === '常规观察') {
    site.protectedStatus = '重点保护';
  }
  site.updatedAt = now;
  site.history = site.history || [];
  site.history.unshift(stamp(
    passed ? '恢复常规观察' : '保留重点保护',
    `${conclusion}（${relationName(site)}）`
  ));

  return { item, passed, conclusion };
}

function formatSigned(value) {
  return value > 0 ? `+${value}` : String(value);
}

function relationName(site) {
  return [site.cave, site.zone, site.pointCode].filter(Boolean).join(' / ');
}

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

function runAction(db, action, item) {
  const related = action.relation ? findRelated(db, action.relation, item) : null;
  const context = { item, related };
  const levelRank = { '低': 1, '中': 2, '高': 3 };
  for (const guard of action.guards || []) {
    const left = getValue(context, guard.left);
    const right = guard.rightPath ? getValue(context, guard.rightPath) : guard.right;
    if (guard.op === 'missing' && left) continue;
    if (guard.op === 'missing' && !left) return { error: guard.message };
    if (guard.op === 'eq' && left !== right) return { error: guard.message };
    if (guard.op === 'neq' && left === right) return { error: guard.message };
    if (guard.op === 'gte' && Number(left) < Number(right)) return { error: guard.message };
    if (guard.op === 'levelGte' && (levelRank[left] || 0) < (levelRank[right] || 0)) return { error: guard.message };
    if (guard.op === 'notIn' && guard.values.includes(left)) return { error: guard.message };
  }
  for (const patch of action.patches || []) {
    const target = patch.target === 'related' ? related : item;
    if (!target) continue;
    const next = patch.valuePath ? getValue(context, patch.valuePath) : patch.value;
    setValue(target, patch.field, next);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(stamp(action.label, action.note || '状态流转'));
  }
  for (const delta of action.deltas || []) {
    const target = delta.target === 'related' ? related : item;
    if (!target) continue;
    const sourceAmount = delta.amountPath ? Number(getValue(context, delta.amountPath)) : 1;
    const multiplier = delta.amount === undefined ? 1 : Number(delta.amount);
    const amount = sourceAmount * multiplier;
    const current = Number(getValue({ target }, `target.${delta.field}`) || 0);
    setValue(target, delta.field, current + amount);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(stamp(action.label, action.note || '数量调整'));
  }
  return { item };
}

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
