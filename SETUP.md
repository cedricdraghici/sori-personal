# Setup Instructions

Complete setup guide for the Sori Translator Chrome extension and backend.

## Prerequisites

- Node.js 14+ installed
- Chrome browser (for testing the extension)
- OpenAI API key ([get one here](https://platform.openai.com/api-keys))

## Backend Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `backend/.env` and set the following:

- `OPENAI_API_KEY=your_openai_api_key_here` - Your OpenAI API key

### 3. Start the Backend

Go into the backend folder:

```bash
cd backend
```

```bash
# Production mode
npm start
```

## Extension Setup

### 1. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the translator-extension folder
5. The extension should now appear in your extensions list

### Test Different Modes

1. Navigate to any webpage
2. Highlight some text (try different languages)
3. A popup should appear with a translation/definition

## Troubleshooting

### "Connection failed" errors

- Verify backend is running (`npm run start` in backend folder)
