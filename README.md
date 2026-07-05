# Secure Financial

Secure Financial is a responsive vanilla HTML/CSS/JavaScript digital banking dashboard backed by Supabase Auth, PostgreSQL, Storage, RLS, Realtime, and admin RPC functions.

## Files

- `index.html` - single page application shell.
- `styles.css` - responsive light/dark banking dashboard UI.
- `app.js` - Supabase auth, profile, user dashboard, admin dashboard, charts, exports, receipts, and realtime refresh.
- `config.js` - local Supabase public project settings.
- `config.example.js` - template for deployment setup.
- `local-server.js` - optional local static server.
- `supabase-schema.sql` - tables, policies, views, triggers, storage bucket, and admin functions.
- `vercel.json` - static deployment headers.

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor and run `supabase-schema.sql`.
3. In Authentication settings, enable email confirmations.
4. Copy `config.example.js` to `config.js` and set:

```js
window.SECURE_FINANCIAL_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-public-anon-key"
};
```

5. Register the first user, then promote that user in SQL:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

## Deployment

Deploy this folder to GitHub and import it into Vercel as a static project.

In Vercel project settings, add these environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Use this build setup:

- Build Command: `npm run build`
- Output Directory: `dist`

For local testing:

```bash
npm run dev
```

Then open `http://localhost:5173`.

For production, keep `config.js` generated from Vercel environment variables or replace it during deployment. Only use the public Supabase anon key in the browser. Never expose the Supabase service-role key.

## Admin Security Note

The included admin actions use RLS-protected SQL RPC functions and never expose a service-role key. Operations that modify Supabase Auth users directly, such as deleting an Auth account or changing another user's password without email confirmation, should be implemented as Supabase Edge Functions using the service-role key on the server side.
