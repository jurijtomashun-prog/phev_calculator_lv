# ⚡ PHEV Cost Calculator — Riga, Latvia

A fully local, client-side web application that calculates and compares real driving costs for a Plug-in Hybrid Vehicle (PHEV) in Riga, Latvia.

## Features

- **Cost per 100 km** — compare home electric, public charging, and fuel costs
- **Live electricity prices** — fetches Nord Pool spot prices for Latvia via `nordpool.didnt.work`
- **Fuel price scraping** — attempts to fetch current 95 octane price from `gas.didnt.work`
- **Break-even analysis** — shows at what electricity price electric driving becomes more expensive than fuel
- **SOC charge cost calculator** — calculate cost to charge between any two SOC levels
- **Sensitivity table** — see how cost changes across a range of electricity prices
- **Surcharges support** — configurable distribution fee, mandatory procurement, VAT for Latvia
- **Seasonal range toggle** — switch between summer/winter electric ranges
- **Persistent settings** — all preferences saved to localStorage
- **Fully offline-capable** — works without internet (except live price fetch)
- **No dependencies** — pure HTML, CSS, and Vanilla JavaScript

## Getting Started

1. Open `index.html` in your browser
2. Enter your vehicle specs (battery capacity, electric range, fuel consumption)
3. The app will attempt to fetch live fuel and electricity prices
4. If fetching fails, manually enter your prices
5. All settings auto-save to your browser's localStorage

## File Structure

```
/
├── index.html              Main application page
├── css/
│   └── styles.css          All styles (CSS variables, grid, responsive)
├── js/
│   ├── storage.js          localStorage save/load/cache
│   ├── calculations.js     All cost formulas (pure functions)
│   ├── api.js              Fuel & electricity price fetching
│   └── app.js              Event binding, state, rendering
├── assets/                 (reserved for future assets)
└── README.md               This file
```

## Data Sources

| Data | Source | Fallback |
|------|--------|----------|
| Electricity (spot) | [nordpool.didnt.work](https://nordpool.didnt.work/api/lv/prices?resolution=60) | Manual input or paste JSON |
| Fuel price (95) | [gas.didnt.work/lv/95](https://gas.didnt.work/lv/95) | Manual input |

## Riga-Specific Defaults

- If charging at home with dynamic tariff - addition of 0.039 Eur
- VAT: 21%
- Default fuel price: ~€1.53/L (95 octane)

## Browser Support

Any modern browser (Chrome, Firefox, Edge, Safari). No IE11 support.

## License

MIT — free to use and modify.

