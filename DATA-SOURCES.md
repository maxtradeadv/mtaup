# Stock Flow — Data Sources

## Current provider policy

The application consumes normalized OHLCV data and optional broker-flow fields. The analysis engine is independent from the data source.

### Active providers

- **Daily Remote CSV** — public daily CSV used as the primary historical/market snapshot source.
- **Yahoo Finance** — third-party historical OHLCV fallback.

### Broker-flow limitation

The active providers do not provide the same per-broker detail that a dedicated broker-summary feed would provide. Therefore the application must not infer broker identity or "smart money" from OHLCV alone. Broker metrics remain neutral when broker rows are unavailable.

No API secret is embedded in the browser bundle.

## Attribution

The remote CSV is an IDX-derived community dataset. Its underlying market-data licensing and redistribution terms must be respected separately from the application source license.
