# Stock Flow — Data Sources

## Current provider set

The PWA uses normalized OHLCV data and optional broker-flow fields. The analysis engine is independent from the data source.

### Daily Remote CSV

Primary daily dataset used by the scanner. It is consumed through the server-side remote CSV adapter and is treated as the application's daily market snapshot source.

### Yahoo Finance

Historical OHLCV fallback/source for price history and backtesting. It is not used as a broker-flow source.

## Removed providers

- **IDX Direct** — removed because direct online IDX access is unreliable for this deployment.
- **Index Alpha** — removed because the service request quota is too restrictive for the scanner workflow.

The application must not depend on either provider for runtime operation.

## Architecture

PWA → normalized data provider → analysis engine → ranking/backtest UI

No provider secret should be embedded in the browser bundle.
