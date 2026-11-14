# Lunar Communication Guardian — Collaborative Workflow Editor

A standalone, editable n8n-style architecture board for a **C-based Lunar South Pole (80°–90° S) communications-planning tool**. All original A01–D08 blocks are included with move, rename, notes, custom blocks, links, JSON import/export, zoom, and navigation.

## Quick start (view and edit on one machine)

Open `index.html` in a browser or run a static server:

```bash
python -m http.server 8080
```

Then open http://localhost:8080. Export JSON to save changes. Without a collaboration service, browser edits are not synchronized across teammates.

## Deploy online

Push these files to a GitHub repository. In **Settings → Pages**, deploy from the `main` branch `/ (root)`. The resulting GitHub Pages link hosts the editor. Alternatively deploy the folder as a static site on Netlify or Vercel.

## Enable shared team editing (Supabase)

1. Create a Supabase project. In **Authentication → Providers → Email**, enable Email login / OTP (magic link). Configure **Site URL** and **Redirect URLs** to your deployed website.
2. Run `schema.sql` in **SQL Editor**. Enable Realtime replication for `public.projects` (Database → Replication).
3. Put your **Project URL** and **publishable / anon key** into `config.js`. This key is intended for browser use; **never put the `service_role` key or a NASA API key there**.
4. Commit and deploy. Each teammate selects **Login**, enters their email, and confirms the magic link.
5. One teammate clicks **New shared project**; the other uses **Join with code** using the invitation code shown in the sidebar. Treat this code as a bearer invitation and share it privately.
6. Edits appear to others after pressing **Save to team**. Realtime announces remote updates. The editor checks server versions and **rejects stale saves rather than overwriting a teammate's work**. If a teammate saves while you have local edits, export your draft JSON before reloading. This is shared online editing with conflict safety, **not Google-Docs-style simultaneous editing in the same field**.

## Security

- Supabase RLS limits project data to authenticated team members. Invitations use high-entropy codes.
- Anyone with a valid invitation code and a confirmed account can join that project; share codes only with teammates. For production, add invitation expiry/revocation and more granular roles.
- Never store credentials (NASA API keys, Supabase service-role keys) in the repository or workflow JSON.
- For private planning, choose a private GitHub repository. GitHub Pages publishing settings may still make the deployed site public; project document access is controlled by Supabase authentication and RLS, not the hosting URL.

## Architecture contents

- A01–A06: LOLA, LROC QuickMap, Moon Trek WMTS, CSPICE, Horizons, dataset validation
- B01–B06: region, DEM tiling, lunar coordinates, horizon ray tracing, ephemeris grid, cache checks
- C01–C08: earth geometry, terrain LOS, ground station, antenna, RF budget, relays, network graph, outage detection
- D01–D08: scheduler, risk, handover, buffering, storage, API, map, alerts

This repo is a **planning dashboard**, not a runnable lunar physics simulator. The computation backend will be implemented separately in C.
