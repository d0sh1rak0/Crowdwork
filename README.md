# Crowdwork

Turn a PDF deck into a spoken script, then rehearse it under the lights — with timing, optional voice tracking, and AI coaching.

## Stack

- Next.js (App Router) + Tailwind CSS
- pdfjs-dist (client-side PDF → images + text)
- Zustand (in-memory session state)
- OpenAI (script generation + rehearsal feedback)

## Setup

```bash
npm install
cp .env.example .env.local
# add OPENAI_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy (Vercel)

1. Push the repo and import into Vercel.
2. Set `OPENAI_API_KEY` in project environment variables.
3. Deploy.

## Routes

| Path | Role |
|------|------|
| `/` | Upload PDF, process slides, setup form |
| `/script` | Edit / regenerate scripts, live time estimate |
| `/rehearse` | Fullscreen rehearsal + report |
| `POST /api/generate-script` | AI speechwriter |
| `POST /api/feedback` | AI coach notes after a run |

## Notes

- Session state is memory-only. Refresh asks for confirmation when a deck is loaded.
- Mic is optional; rehearsal works with timers alone if denied or unsupported.
- UI copy is English; generated scripts and speech recognition support English and Russian.
