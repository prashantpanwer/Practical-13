# Practical-13

Practical-13 🚀 Node.js Advanced Middleware Architecture University Project — Task 1 & Task 2 Implementation

📘 Overview

This project demonstrates advanced Express.js middleware architecture concepts through two key tasks:

Task 1: Streaming & Backpressure + Client Abort-Aware Middleware Task 2: Content Negotiation Middleware (JSON vs. XML) It focuses on middleware order, clean structure, and robust error handling.

🧠 Task 1 — Streaming & Backpressure + Client Abort-Aware Middleware

🎯 Goal Implement a streaming NDJSON endpoint that:

Produces continuous JSON objects line by line. Properly handles backpressure. Stops streaming immediately when the client disconnects. ⚙️ Features ✅ NDJSON streaming output

✅ Handles res.write() buffer with backpressure control

✅ Detects client disconnect via AbortController

✅ Graceful cleanup of background work

✅ Middleware stack:

Request ID correlation Response timing JSON body limit CORS whitelist Centralized error handling 🧩 Endpoints GET /stream Streams NDJSON data.

🌐 Task 2 — Content Negotiation Middleware (JSON vs. XML) 📘 Overview This project demonstrates how to implement Content Negotiation in Node.js (Express.js) using a reusable middleware that dynamically returns responses in JSON or XML, based on the Accept header of the incoming request.

It follows best practices for middleware design, RFC-7807 error handling, and secure Express app configuration.

🎯 Goal Build a middleware that:

Returns JSON or XML depending on the client’s Accept header. Uses a reusable negotiate() function for multiple routes. Follows RFC 7807 (problem+json) for standardized error responses. Integrates with a secure and ordered middleware pipeline. ⚙️ Features ✅ Supports both application/json and application/xml

✅ Returns a 406 Not Acceptable for unsupported types

✅ Built on Express.js with clean, modular middleware

✅ Centralized RFC-7807 error handling

✅ Includes headers: X-Request-Id and X-Response-Time-ms

✅ Easily extendable for other formats

🧩 Endpoints GET /user/:id Returns user details based on the requested format.

JSON Request: curl -H "Accept: application/json" http://localhost:3000/user/1

curl -N http://localhost:3000/stream
