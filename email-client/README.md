# email-client — web UI

The React + Vite single-page app for the email client. It's a pure frontend that
talks to the Worker API in [`../workers`](../workers).

**Setup and run instructions live in the [root README](../README.md).** Quick
start:

```bash
npm install
cp .env.example .env.local     # set VITE_API_URL (defaults to localhost:8787)
npm run dev                    # http://localhost:5173
```

- `npm run dev` — dev server with HMR
- `npm run build` — type-check + production build to `dist/`
- `npm run lint` — oxlint
