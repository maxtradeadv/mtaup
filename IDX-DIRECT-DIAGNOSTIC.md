# IDX direct endpoint diagnostic

The production backend currently receives HTTP 403 from `https://www.idx.co.id/id` before it can establish a session. IDX public JSON endpoints are protected by anti-bot/Cloudflare/Imperva controls in some environments. This file records the limitation so a 403 is not misdiagnosed as an engine failure.

Current backend path: `ensureSession()` fetches `IDX_HOME` first, then sends the session cookie to `/primary/TradingSummary/GetStockSummary` and `/primary/TradingSummary/GetBrokerSummary`.

A future provider adapter should use a browser-capable/proxy path or another legally permitted data source rather than attempting to bypass anti-bot controls with spoofed headers.
