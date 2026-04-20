# BagVertising Renamer

AI-powered photo renaming tool for MARC Group BagVertising bags.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Run locally
```bash
npm run dev
```

### 3. Deploy to Vercel

#### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/bagvertising-renamer.git
git push -u origin main
```

#### Step 2 — Connect to Vercel
1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New Project**
3. Import your `bagvertising-renamer` repo
4. Click **Deploy** (no build settings needed — Vercel auto-detects Vite)

#### Step 3 — Add your Gemini API key
1. In Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Add: `GEMINI_API_KEY` = your Gemini API key
3. Click **Save**, then **Redeploy**

That's it. Your site will be live at `https://bagvertising-renamer.vercel.app`

## How it works

- Upload 7 photos per bag in order (lowest filename = bottom photo)
- AI reads the BAG code from the bottom photo via Gemini API
- All 7 photos are renamed automatically
- Drag and drop slots to fix any ordering issues
- Manual code entry available on every bag
- Supports JPG, PNG, and RAW formats (CR3, NEF, ARW auto-converted)

## Project structure

```
bagvertising-renamer/
├── api/
│   └── read-bag-code.js     # Vercel serverless function (Gemini API proxy)
├── src/
│   ├── App.jsx              # Main React component
│   ├── App.module.css       # Styles
│   ├── main.jsx             # Entry point
│   ├── index.css            # Global styles
│   └── hooks/
│       └── useFFmpeg.js     # RAW file conversion hook
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```
