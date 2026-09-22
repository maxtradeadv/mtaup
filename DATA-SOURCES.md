# Stock Flow — Data Sources

## Current prototype

The PWA is designed to consume normalized OHLCV data and optional broker-flow fields. The analysis engine is independent from the data source.

## Open-source / public sources investigated

### Pholenk/IDX-Dataset

Repository: https://github.com/Pholenk/IDX-Dataset

Provides machine-readable IDX-derived datasets in CSV and JSON, organized by index and stock ticker. The repository states that the dataset is updated daily and is licensed under ODbL 1.0, with attribution and share-alike requirements for derivative databases.

Use in Stock Flow: historical/backtest data and daily snapshots.

### NeaByteLab/IDX-API

Repository: https://github.com/NeaByteLab/IDX-API

Open-source Deno/TypeScript data pipeline wrapping IDX market-data endpoints. Its documented modules include daily OHLC/volume, historical trading data, foreign trading, broker summary, and broker participant information.

Use in Stock Flow: a future server-side ingestion adapter. It should not be called directly from the browser if credentials, rate limits, or CORS make that inappropriate.

## Important distinction

Open-source code does not necessarily mean the underlying market data is open/public-domain. The source repositories above state that some data is derived from IDX. Stock Flow should preserve attribution/license requirements and should not assume that an open-source wrapper grants unrestricted redistribution or real-time commercial data rights.

## Planned architecture

PWA -> normalized data provider -> analysis engine -> ranking/backtest UI

Provider adapters can later include:

- open historical dataset
- server-side IDX API wrapper
- Yahoo Finance-compatible historical source
- licensed real-time provider

No API secret should be embedded in the browser bundle.
