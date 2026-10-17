# My Daily Journal
Local-first journal: Vite + TypeScript, no framework. Data lives in IndexedDB in your browser.

## Structure
- `index.html` – page markup
- `src/style.css` – all styles (light/dark, responsive)
- `src/main.ts` – app logic (storage, repository, views, actions)
- `supabase/schema.sql` – cloud table + Row Level Security (not connected yet)
- `.cursor/rules/journal.mdc` – project rules for Cursor

## Run
```
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs dist/
```

## Status
Implemented: dashboard, journal, notes, calendar, tasks (with time), habits, goals, reflections, rotating quotes, themes, JSON/MD/TXT export, validated import.
Accounts: email sign-up/sign-in and sync through Supabase (`src/cloud.ts`). Written but NOT yet tested against a real Supabase project. Not implemented: account deletion (needs a server-side function), server-side AI endpoint. Local storage is not encrypted.

## Supabase setup (enables login, registration and sync)
1. Create a project at supabase.com.
2. SQL Editor: paste and run `supabase/schema.sql` (creates the table, version counter and Row Level Security).
3. Authentication -> Providers: keep Email enabled. Authentication -> URL Configuration: set Site URL to your app address and add `http://localhost:5173` and your GitHub Pages URL as redirect URLs.
4. Project Settings -> API: copy the Project URL and the publishable (anon) key into `.env` (see `.env.example`). Never use the service-role key here.
5. `npm run dev`, open Account, create an account (confirm the email if confirmation is on) and sign in.
6. For GitHub Pages: repo Settings -> Secrets and variables -> Actions, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### Google sign-in (optional, in addition to email)
1. Google Cloud Console -> APIs & Services -> OAuth consent screen: set up the app (External), add your email as a test user while testing.
2. Credentials -> Create credentials -> OAuth client ID -> Web application. Authorized redirect URI: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` (shown in Supabase when you open the Google provider).
3. Supabase -> Authentication -> Providers -> Google: enable it and paste the Client ID and Client Secret. The secret goes only in the Supabase dashboard, never in this app or `.env`.
4. Supabase -> Authentication -> URL Configuration: Site URL = your app address; add `http://localhost:5173` and your GitHub Pages URL to Redirect URLs.
5. In the app: Account -> Continue with Google.

Sync rules: pull first, then push. Edits are only pushed if the cloud copy is the version this device last saw. If two devices edit the same note, both versions are kept (a "conflict copy" note); for tasks, habits and goals the newer edit wins. Deletes are tombstones. A device that holds another account's data refuses to sync until that data is exported and cleared. Sync runs after edits, every minute, and when the browser comes back online.

## Next steps
1. Split `main.ts` into `db.ts`, `repo.ts`, `views/*.ts`, `actions.ts`, `sync.ts`.
2. Test sync with two devices; add account deletion (Edge Function) and the optional AI endpoint.

## Deploy
Push to `main`; set Settings -> Pages -> Source: GitHub Actions. Journal data stays in each visitor's browser, never in the repo.
