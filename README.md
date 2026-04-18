# Patch — EQ Asset Capture → Brand v1.3

Drop-in replacement files to align `eq-solves-assets` with EQ Design Brief v1.3.

## What's in here

```
patches/eq-solves-assets/
├── tailwind.config.js             ← replaces repo root file
├── index.html                     ← replaces repo root file
├── src/
│   └── index.css                  ← replaces src/index.css
└── public/
    └── fonts/
        ├── PlusJakartaSans-VariableFont_wght.ttf           ← NEW
        └── PlusJakartaSans-Italic-VariableFont_wght.ttf    ← NEW
```

## What changes visually

| Token          | Before         | After           | Where it shows up                                |
|----------------|----------------|-----------------|--------------------------------------------------|
| Deep Blue      | `#2B7CA6`      | **`#2986B4`**   | Hover on every primary button                    |
| Border         | `#D5E6EF`      | **`#E5E7EB`**   | Every card, input, divider, row, modal           |
| Status OK      | `#2E7D32`      | **`#16A34A`**   | Synced pills, success toasts                     |
| Status Warn    | `#E6A700`      | **`#D97706`**   | Pending pill in TopBar                           |
| Status Bad     | `#C03232`      | **`#DC2626`**   | Error pill, delete buttons                       |
| Muted text     | `#6B7280`      | **`#666666`**   | Secondary labels, timestamps                     |
| Font loading   | Google CDN     | **Self-hosted** | Faster first paint; works offline                |

## Apply it (2 minutes)

```bash
cd eq-solves-assets
git checkout -b design/brief-v1.3-alignment

# Copy the three files + the two fonts from this project
# (paths below assume you dragged the patches/ folder next to eq-solves-assets/)
cp ../patches/eq-solves-assets/tailwind.config.js  ./tailwind.config.js
cp ../patches/eq-solves-assets/index.html          ./index.html
cp ../patches/eq-solves-assets/src/index.css       ./src/index.css
mkdir -p public/fonts
cp ../patches/eq-solves-assets/public/fonts/*.ttf  ./public/fonts/

npm run dev   # sanity check — colours shift, nothing should break
```

If the dev server renders cleanly:

```bash
git add tailwind.config.js index.html src/index.css public/fonts
git commit -m "design: align to EQ Brand v1.3

- Deep Blue 2B7CA6 → 2986B4
- Border D5E6EF → E5E7EB (neutral grey, matches spec)
- Status colours to Tailwind-aligned spec trio
- Muted 6B7280 → 666666 (EQ Mid Grey)
- Self-host Plus Jakarta Sans (remove Google Fonts CDN)
"
git push -u origin design/brief-v1.3-alignment
```

Open a PR to `main`.

## Follow-ups not in this patch

- `src/pages/HomePage.tsx` — three emoji buttons (📋 🔧 🚪) should become 16×16 Lucide-style SVGs to match the app's otherwise all-SVG icon language. Separate PR.
- `EqMark size={14}` in the footer is below the 24px logo minimum — worth confirming whether "inline lockup with EQ Solutions wordmark" counts as exempt or whether to bump to 20px. Human call.

## Why these specific values

Every value above is pulled from `eq-solutions/eq-context/rules/brand.md` and EQ Design Brief v1.3 (the single source of truth). The goal is that Service, Field, Assets, and any future EQ app render the same pill, same button, same border, same background — so an internal user switching apps feels continuity, not a wardrobe change.
