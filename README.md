# Ollie

A human-in-the-loop Slack relay bot. External workspaces install Ollie; DMs and `@mentions` get proxied into a dedicated channel in your Slack, and your thread replies get relayed back.

---

## 1. Create the two Slack apps (5 min)

Both are created "From a manifest". Paste files are in `slack/`.

### App A — **Ollie** (public, installable by anyone)

1. Go to https://api.slack.com/apps → **Create New App** → **From a manifest**.
2. Pick a workspace (doesn't really matter which — this app is *distributed*, not tied to it).
3. Paste the contents of `slack/ollie-public.manifest.json`.
4. You'll see validation warnings about `PUBLIC_BASE_URL`. Ignore for now; you'll edit after you have a public URL.
5. Click **Create**.
6. From the app's **Basic Information** page, copy:
   - **Client ID** → `SLACK_PUBLIC_CLIENT_ID`
   - **Client Secret** → `SLACK_PUBLIC_CLIENT_SECRET`
   - **Signing Secret** → `SLACK_PUBLIC_SIGNING_SECRET`
7. Generate a long random string for `SLACK_PUBLIC_STATE_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

### App B — **Ollie Console** (installed only in YOUR workspace)

1. Same flow: **Create New App** → **From a manifest**.
2. Pick **your personal Slack workspace**.
3. Paste `slack/ollie-operator.manifest.json`.
4. Click **Create**.
5. Click **Install to Workspace**, approve.
6. From **OAuth & Permissions**, copy the **Bot User OAuth Token** (`xoxb-...`) → `SLACK_OPERATOR_BOT_TOKEN`.
7. From **Basic Information**, copy the **Signing Secret** → `SLACK_OPERATOR_SIGNING_SECRET`.
8. Your own Slack user ID → `SLACK_OPERATOR_USER_ID`. Find it: in Slack, click your profile → **More** → **Copy member ID**.

---

## 2. Local setup (one command)

```bash
./bin/setup.sh
```

This installs deps, creates the `ollie` Postgres database, and copies `.env.example` → `.env`.

Then edit `.env` with the values from step 1.

---

## 3. Expose your local server

Slack needs a public HTTPS URL to deliver events. Easiest option:

```bash
ngrok http 3000
```

Copy the `https://<random>.ngrok-free.app` URL. This is your `PUBLIC_BASE_URL` for local dev.

Now go back into each Slack app and:

- **Ollie (public)** → **Event Subscriptions** → set Request URL to `<PUBLIC_BASE_URL>/slack/events`.
- **Ollie (public)** → **OAuth & Permissions** → set Redirect URL to `<PUBLIC_BASE_URL>/slack/oauth_redirect`.
- **Ollie Console** → **Event Subscriptions** → set Request URL to `<PUBLIC_BASE_URL>/slack/operator/events`.

Put the same `PUBLIC_BASE_URL` into `.env`.

---

## 4. Run it

```bash
yarn dev
```

Visit `<PUBLIC_BASE_URL>/` → it redirects to Slack's install flow for the **Ollie** app. Install it into a *test workspace* (not your own — that's what Ollie Console is for).

After install:

1. Your personal Slack gets a new channel `#ollie-<testworkspace>-xxxx` with a welcome message.
2. DM "Ollie" from the test workspace → the message shows up as a new thread in your channel.
3. Reply in that thread → your reply appears in the test workspace's DM with Ollie.

---

## 5. Deploy to Render

1. Push this repo to GitHub.
2. In Render → **New** → **Blueprint** → point at the repo. Render reads `render.yaml` and creates the web service + Postgres.
3. In the service's **Environment** tab, fill in all `sync: false` env vars with the same values from your `.env` (but swap `PUBLIC_BASE_URL` for the Render URL).
4. Update the three Slack URLs from step 3 to use your Render URL.
5. First boot: shell into the DB and run `src/db/schema.sql`, or just run `yarn db:init` from the Render shell.

---

## Architecture at a glance

```
External workspace                 Your workspace (Ollie Console installed)
─────────────────                  ──────────────────────────────────────
DM to @Ollie         ─────►   #ollie-<workspace> channel
                                   │
                                   ├── New top-level msg: header (who/where)
                                   │     └── threaded: user's message
                                   │     └── threaded: YOUR reply  ─────► back to user's DM
                                   │     └── threaded: user's follow-up
                                   │
@Ollie in #general   ─────►        ├── New top-level msg: header
                                   │     └── threaded: mention text
                                   │     └── threaded: YOUR reply  ─────► posted as thread reply in #general
                                   │     └── threaded: next reply in that thread
```

Mapping key: `(external_team_id, external_channel_id, external_thread_ts)`. DMs collapse to a single thread per user (`thread_ts` is `NULL`).

---

## Scripts

| Command | What it does |
|---|---|
| `yarn dev` | Run the server with file watching (tsx) |
| `yarn build` | Compile TypeScript → `dist/` |
| `yarn start` | Run compiled build |
| `yarn typecheck` | Type-only check |
| `yarn db:init` | Apply `src/db/schema.sql` to `$DATABASE_URL` |
| `./bin/setup.sh` | First-time local bootstrap |
