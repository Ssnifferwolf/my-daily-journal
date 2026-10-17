# My Daily Journal

A local-first journal built with Vite and TypeScript. Your data is stored in IndexedDB in your browser.

## Structure

- `index.html` - Page markup
- `src/style.css` - Styles, including light and dark themes and responsive layouts
- `src/main.ts` - Application logic, storage, repository, views, and actions
- `supabase/schema.sql` - Cloud database table and Row Level Security configuration
- `.cursor/rules/journal.mdc` - Project rules for Cursor

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

### Google Sign-In (Optional)

1. In [Google Cloud Console](https://console.cloud.google.com/), configure the OAuth consent screen.
2. Create an OAuth client ID for a web application.
3. Use the callback URL shown in your Supabase Google provider settings. It will resemble `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.
4. Enable Google under Supabase Authentication Providers and enter the required OAuth credentials.
5. Add your local development URL and deployed application URL to Supabase's allowed redirect URLs.
6. Test Google sign-in through the Account section.

Keep the Google client secret in the appropriate server-side or provider configuration. Never put it in frontend code.

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

To deploy with GitHub Pages:

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
