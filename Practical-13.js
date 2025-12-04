const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats').default;
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_WHITELIST = (process.env.CORS_WHITELIST || 'http://localhost:5173,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '100kb';

const nowNs = () => process.hrtime.bigint();
const nsToMsString = nsBigInt => (Number(nsBigInt) / 1_000_000).toFixed(3);

function buildProblem({ type = 'about:blank', title, status = 500, detail, instance, extra = {} }) {
  const body = { type, title: title || (status === 500 ? 'Internal Server Error' : undefined), status, detail, instance, ...extra };
  Object.keys(body).forEach(k => (body[k] === undefined) && delete body[k]);
  return body;
}

process.on('unhandledRejection', r => console.error('[process] unhandledRejection:', r));
process.on('uncaughtException', e => console.error('[process] uncaughtException:', e));

app.use(helmet());

app.use((req, res, next) => {
  req.id = req.get('X-Request-Id') || randomUUID();
  req.startNs = nowNs();
  res.setHeader('X-Request-Id', req.id);
  const originalEnd = res.end;
  let ended = false;
  res.end = function (...args) {
    if (!ended) {
      ended = true;
      try {
        const tookMs = nsToMsString(nowNs() - (req.startNs || nowNs()));
        if (!res.headersSent) {
          res.setHeader('X-Response-Time-ms', tookMs);
          res.setHeader('X-Request-Id', req.id);
        } else {
          try {
            res.setHeader('X-Response-Time-ms', tookMs);
            res.setHeader('X-Request-Id', req.id);
          } catch {}
        }
      } catch (err) {
        console.error('timing header error', err);
      }
    }
    return originalEnd.apply(this, args);
  };
  next();
});

app.use(cors({
  origin: (origin, cb) => { if (!origin) return cb(null, true); if (CORS_WHITELIST.includes(origin)) return cb(null, true); cb(new Error('CORS origin not allowed')); },
  optionsSuccessStatus: 204,
  exposedHeaders: ['X-Request-Id', 'X-Response-Time-ms'],
}));

app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use((req, res, next) => {
  req.log = (...a) => console.log(`[${new Date().toISOString()}] [req:${req.id}]`, ...a);
  req.log('incoming', req.method, req.originalUrl);
  next();
});

app.use((req, res, next) => {
  const ac = new AbortController();
  req.abortController = ac;
  req.signal = ac.signal;
  const onClose = () => {
    if (!ac.signal.aborted) {
      ac.abort();
      req.log('client disconnected — aborting signal');
    }
  };
  req.on('close', onClose);
  res.on('finish', () => req.off('close', onClose));
  next();
});

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
function validateSchema(schema) {
  const validate = ajv.compile(schema);
  return (req, res, next) => {
    if (validate(req.body)) return next();
    const errors = validate.errors || [];
    const detail = errors.map(e => `${e.instancePath || '/'} ${e.message}`).join('; ');
    const err = new Error('Validation failed');
    err.status = 400;
    err.problem = buildProblem({
      type: 'https://example.com/probs/invalid-request',
      title: 'Request validation failed',
      status: 400,
      detail,
      instance: req.originalUrl,
      extra: { errors },
    });
    next(err);
  };
}

const asyncWrap = fn => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(next);
};

app.post('/order', validateSchema({
  type: 'object',
  required: ['itemId', 'quantity'],
  properties: { itemId: { type: 'string', minLength: 1 }, quantity: { type: 'integer', minimum: 1 }, notes: { type: 'string' } },
  additionalProperties: false,
}), asyncWrap(async (req, res) => {
  await new Promise(r => setTimeout(r, 30));
  const created = { id: randomUUID(), itemId: req.body.itemId, quantity: req.body.quantity, notes: req.body.notes || null, createdAt: new Date().toISOString() };
  req.log('order created', created.id);
  res.status(201).json({ data: created });
}));

app.get('/ping', (req, res) => res.json({ pong: true, now: new Date().toISOString() }));

function isJsonParseError(err) { return err instanceof SyntaxError && 'body' in err && err.status === 400; }

app.use((err, req, res, next) => {
  try {
    const status = err.status ? Number(err.status) : 500;
    const tookMs = req && req.startNs ? nsToMsString(nowNs() - req.startNs) : undefined;
    if (tookMs) res.setHeader('X-Response-Time-ms', tookMs);
    if (req && req.id) res.setHeader('X-Request-Id', req.id);
    if (isJsonParseError(err)) {
      const p = buildProblem({ type: 'https://example.com/probs/invalid-json', title: 'Malformed JSON', status: 400, detail: err.message, instance: req ? req.originalUrl : undefined });
      return res.status(400).type('application/problem+json').json(p);
    }
    if (err.message === 'CORS origin not allowed') {
      const p = buildProblem({ type: 'https://example.com/probs/cors', title: 'CORS origin not allowed', status: 403, detail: 'The requesting origin is not allowed by server CORS policy.', instance: req ? req.originalUrl : undefined });
      return res.status(403).type('application/problem+json').json(p);
    }
    if (err.problem) {
      return res.status(err.problem.status || status).type('application/problem+json').json(err.problem);
    }
    const problem = buildProblem({ title: err.name || 'Internal Server Error', status, detail: status >= 500 ? 'Internal server error' : err.message, instance: req ? req.originalUrl : undefined });
    if (status >= 500) console.error(`[ERROR] [req:${req ? req.id : 'unknown'}]`, err); else console.warn(`[WARN] [req:${req ? req.id : 'unknown'}]`, err.message || err);
    return res.status(status).type('application/problem+json').json(problem);
  } catch (e) {
    console.error('Error handler failed', e);
    try {
      if (!res.headersSent) {
        if (req && req.id) res.setHeader('X-Request-Id', req.id);
        res.setHeader('X-Response-Time-ms', req && req.startNs ? nsToMsString(nowNs() - req.startNs) : '0.000');
        res.status(500).type('application/problem+json').json(buildProblem({ status: 500, title: 'Internal Server Error' }));
      } else res.end();
    } catch { res.end(); }
  }
});

async function delay(ms, signal) {
  if (signal && signal.aborted) throw new Error('aborted');
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); const err = new Error('aborted'); err.name = 'AbortError'; reject(err); };
    function cleanup() { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
    if (signal) signal.addEventListener('abort', onAbort);
  });
}

async function* produceNdjsonItems(count = 100, intervalMs = 200, signal) {
  for (let i = 0; i < count; i++) {
    if (signal && signal.aborted) break;
    await delay(intervalMs, signal);
    if (signal && signal.aborted) break;
    const item = { seq: i + 1, id: randomUUID(), ts: new Date().toISOString(), msg: `item ${i + 1}` };
    yield item;
  }
}

app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Transfer-Encoding', 'chunked');
  const signal = req.signal;

  let ended = false;
  const endStream = (code = 200) => {
    if (ended) return;
    ended = true;
    try { res.end(); } catch {}
  };

  req.on('close', () => {
    if (!signal.aborted) {
      req.log('client closed connection');
    }
  });

  (async () => {
    try {
      for await (const item of produceNdjsonItems(1000, 100, signal)) {
        if (signal.aborted) {
          req.log('stream aborted by client signal');
          break;
        }
        const line = JSON.stringify(item) + '\n';
        const ok = res.write(line);
        if (!ok) {
          await new Promise(resolve => {
            const onDrain = () => { res.off('close', onClose); resolve(); };
            const onClose = () => { res.off('drain', onDrain); resolve(); };
            res.once('drain', onDrain);
            res.once('close', onClose);
          });
        }
      }
      endStream();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        req.log('streaming stopped due to abort');
        endStream();
        return;
      }
      req.log('streaming error', err);
      if (!res.headersSent) res.setHeader('Content-Type', 'application/problem+json');
      if (!res.writableEnded) {
        const p = buildProblem({ title: 'Streaming error', status: 500, detail: err.message || 'stream error' });
        try { res.statusCode = 500; res.end(JSON.stringify(p)); } catch { try { res.end(); } catch {} }
      }
    }
  })();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('CORS whitelist:', CORS_WHITELIST);
});