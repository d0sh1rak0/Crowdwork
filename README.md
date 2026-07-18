# Crowdwork

Turn a PDF deck into a spoken script, then rehearse it under the lights — with timing, Whisper voice tracking, TTS playback, tough questions, and AI coaching.

## Stack

- **Frontend:** HTML / CSS / vanilla JavaScript (ES modules)
- **Backend:** Express (`server.mjs`)
- **PDF:** pdf.js (CDN, client-side)
- **Gemini 2.5 Flash** — script generation + rehearsal feedback
- **Groq Whisper** — speech-to-text during rehearsal
- **Groq LLM** — questioning / objections
- **OpenAI** — text-to-speech (“Play voice”)

## Setup

```bash
npm install
cp .env.example .env.local
# fill in API keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Script + feedback |
| `GROQ_WHISPER_API_KEY` | Rehearsal transcription |
| `GROQ_LLM_API_KEY` | Tough questions / objections |
| `OPENAI_API_KEY` | TTS playback |

Never commit `.env.local`.

## Pages

| Path | Role |
|------|------|
| `/` | Upload PDF + setup form |
| `/script` | Edit scripts, regenerate, play voice |
| `/rehearse` | Fullscreen rehearsal + report |

## API

- `POST /api/generate-script`
- `POST /api/feedback`
- `POST /api/objections`
- `POST /api/transcribe` (multipart audio)
- `POST /api/speak` (returns MP3)
- `GET /api/health`

## Deploy (Vercel)

1. Import the repo.
2. Set the four API keys as project environment variables.
3. Deploy (`vercel.json` routes traffic through `server.mjs`).
