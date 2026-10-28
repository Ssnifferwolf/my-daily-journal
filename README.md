# My Daily Journal

A local-first journal built with Vite and TypeScript. Your data is stored in IndexedDB in your browser.

## Structure

- `index.html` - Page markup
- `src/style.css` - Styles, including light and dark themes and responsive layouts
- `src/main.ts` - Application logic, storage, repository, views, and actions
- `supabase/schema.sql` - Cloud database table and Row Level Security configuration

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL shown in your terminal, usually `http://localhost:5173`.

Build the project:

```bash
npm run build
```

The production build is generated in the `dist/` directory.

## Features and Status

Implemented features include:

- Dashboard
- Journal entries and notes
- Calendar
- Tasks with scheduled times
- Habits and goals
- Reflections and rotating quotes
- Light and dark themes
- JSON, Markdown, and TXT export
- Validated data import

### Accounts and Cloud Sync

Email authentication and synchronization are implemented in `src/cloud.ts` but have not yet been tested against a live Supabase project.

Not yet implemented:

- Account deletion through a server-side function
- Server-side AI endpoint

**Privacy note:** Local journal data is not encrypted by the application.

## Supabase Setup

Supabase enables account registration, sign-in, and cloud synchronization.

1. Create a project at [Supabase](https://supabase.com/).
2. Open the SQL Editor and run the contents of `supabase/schema.sql`.
3. Under Authentication, enable email authentication.
4. Configure the Site URL and allowed redirect URLs under Authentication URL Configuration. Include `http://localhost:5173` for local development.
5. Open Project Settings and find your project URL and publishable key.
6. Add these values to your local `.env` file using the variable names shown in `.env.example`.
7. Run `npm run dev`, open the Account section, and test registration and sign-in.

Never expose a Supabase service-role key in frontend code or commit secrets to GitHub.

If an existing project reports `permission denied for table records`, run this in the Supabase SQL Editor:

```sql
grant select, insert, update on public.records to authenticated;
```

This grants table access to signed-in users; the Row Level Security policies above still restrict each user to their own rows.

## Synchronization Rules

- Pull cloud changes before pushing local changes.
- Local edits are pushed only when the cloud version matches the version last seen by the device.
- If two devices edit the same note, both versions are retained as separate conflict-copy notes.
- For tasks, habits, and goals, the newer edit wins.
- Deletions are represented by tombstones.
- A device containing another account's data refuses to synchronize until that data has been exported and cleared.
- Synchronization runs after edits, periodically, and when the browser comes back online.

Test these behaviours with a real Supabase project before relying on cloud synchronization.

## Deployment

`.env` is not uploaded to GitHub. Hosted builds only get login if you add the same two names as **build** environment variables, then trigger a new deploy.

### Netlify (GitHub)

1. Open the site in Netlify → **Site configuration** → **Environment variables**.
2. Add:
   - `VITE_SUPABASE_URL` = your project URL (`https://xxxx.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY` = the **publishable** / anon key (`sb_publishable_...` or `eyJ...`)
3. Use those exact names. `NEXT_PUBLIC_...` names will not work in this app.
4. **Deploys** → **Trigger deploy** → **Clear cache and deploy site**. Vite reads the variables only while building.
5. In Supabase → **Authentication** → **URL Configuration**, set Site URL to your Netlify URL (`https://your-site.netlify.app`) and add it under Redirect URLs.

### GitHub Pages

1. Push your project to the `main` branch.
2. Configure GitHub Pages to use GitHub Actions under repository Settings → Pages.
3. Configure the required repository secrets or variables for the Supabase project URL and publishable key.
4. Ensure the deployment workflow builds the project and publishes the `dist/` directory correctly.

Journal data stored in visitors' browsers is not stored in the Git repository. Cloud synchronization, if configured, stores data in Supabase.

## Next Steps

- Split `src/main.ts` into smaller modules such as `db.ts`, `repo.ts`, `views/`, `actions.ts`, and `sync.ts`.
- Test synchronization across two devices.
- Implement account deletion using a server-side function.
- Add an optional server-side AI endpoint.
- Review privacy and security before production deployment.
