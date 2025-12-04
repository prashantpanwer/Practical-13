const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { randomUUID } = require("crypto");
const js2xmlparser = require("js2xmlparser");

const app = express();
const PORT = process.env.PORT || 3000;

const CORS_WHITELIST = (process.env.CORS_WHITELIST || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nowNs = () => process.hrtime.bigint();
const nsToMsString = (nsBigInt) => (Number(nsBigInt) / 1_000_000).toFixed(3);

function problemJson({ type = "about:blank", title, status = 500, detail, instance }) {
  const body = { type, title, status, detail, instance };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  return body;
}

// ---------------------------
// Middleware Stack
// ---------------------------

app.use(helmet());

app.use((req, res, next) => {
  req.id = req.get("X-Request-Id") || randomUUID();
  req.startNs = nowNs();
  res.setHeader("X-Request-Id", req.id);
  const originalEnd = res.end;
  res.end = function (...args) {
    try {
      const tookMs = nsToMsString(nowNs() - req.startNs);
      res.setHeader("X-Response-Time-ms", tookMs);
      res.setHeader("X-Request-Id", req.id);
    } catch {}
    originalEnd.apply(this, args);
  };
  next();
});

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (CORS_WHITELIST.includes(origin)) return cb(null, true);
      cb(new Error("CORS origin not allowed"));
    },
    exposedHeaders: ["X-Request-Id", "X-Response-Time-ms"],
  })
);

app.use(express.json({ limit: "100kb" }));

// ---------------------------
// Reusable negotiate() middleware
// ---------------------------
function negotiate() {
  return (req, res, next) => {
    res.negotiate = (data, rootName = "response") => {
      const accept = req.accepts(["json", "xml"]);

      if (accept === "xml") {
        const xml = js2xmlparser.parse(rootName, data);
        res.type("application/xml");
        res.send(xml);
      } else if (accept === "json") {
        res.json(data);
      } else {
        const problem = problemJson({
          type: "https://example.com/probs/not-acceptable",
          title: "Not Acceptable",
          status: 406,
          detail: "Supported content types: application/json, application/xml",
          instance: req.originalUrl,
        });
        res.status(406).json(problem);
      }
    };
    next();
  };
}

app.use(negotiate());

// ---------------------------
// Demo endpoints
// ---------------------------

app.get("/user/:id", (req, res) => {
  const user = {
    id: req.params.id,
    name: "Alice",
    joined: "2024-02-12",
    role: "admin",
  };
  res.negotiate(user, "user");
});

app.get("/status", (req, res) => {
  const status = {
    service: "content-negotiation-demo",
    uptimeSeconds: process.uptime(),
    time: new Date().toISOString(),
  };
  res.negotiate(status, "status");
});

// ---------------------------
// Error handler (RFC 7807)
// ---------------------------

app.use((err, req, res, next) => {
  const status = err.status || 500;
  const problem = err.problem || problemJson({
    title: err.message || "Internal Server Error",
    status,
    instance: req.originalUrl,
  });
  res.status(status).type("application/problem+json").json(problem);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});