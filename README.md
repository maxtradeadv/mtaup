# Stock Flow Scanner

PWA mobile-first untuk screening akumulasi/distribusi saham.

## MVP
- Mode ALL Stocks dan single stock
- Pareto Top 5 BUY dan Top 5 SELL
- Accumulation / Distribution score
- Volume anomaly, trend, support, resistance, breakdown risk
- Backtest T+1/T+3/T+5 tanpa look-ahead
- CSV import
- Offline service worker

## Broker flow
CSV dapat memakai kolom opsional `brokerNetValue`. Nilai positif berarti net flow masuk menurut data yang diimpor, negatif berarti net flow keluar. Aplikasi **tidak menebak identitas pembeli/penjual dari OHLCV**. Kode broker akan menjadi lapisan tambahan ketika data broker-summary tersedia.

Format CSV minimum:
`date,ticker,open,high,low,close,volume`

Opsional:
`value,brokerNetValue`

Untuk broker detail, tahap berikutnya dapat memakai data per broker per hari: `date,ticker,broker,buyValue,sellValue,buyVolume,sellVolume`. Dari sana engine akan menghitung persistence, concentration, rotation, dan net-flow consistency tanpa menganggap broker tertentu selalu mewakili retail atau institusi.

## Data
Versi awal memakai data demo dan CSV. Untuk data IDX otomatis/live, gunakan provider berlisensi atau sumber yang memang mengizinkan penggunaan aplikasi; jangan menaruh API secret di JavaScript frontend GitHub Pages.


### V3 accuracy engine
- Accumulation and distribution are scored independently; distribution is no longer a simple inverse of accumulation.
- Live Index Alpha detail fetches broker summaries across the latest 20 trading sessions so persistence, divergence and rotation can use historical broker flow.
- Signal thresholds were made slightly more sensitive on the SELL side, but should be calibrated further against out-of-sample historical results rather than tuned to a single stock.
