# RocketRide workspace

The OPENSTATE frontend as a RocketRide App Builder app. The Next.js app in
the repo root stays the backend; this app is a React remote on the RocketRide
shell that calls it over HTTP (CORS is enabled on `/api/*` in
`next.config.ts`).

```
rocketride-app/
  apps/openstate/        the app (scaffolded with `rocketride app create`)
    src/App.tsx          Overview, Company, Ask, Observers, Live dashboard
    package.json         appManifest + the Backend URL setting
  pipelines/             .pipe files (the ops pipeline lives in ../rocketride/)
  .rocketride/           vendored platform packages and docs (gitignored)
```

## Build, verify, deploy

```bash
cd rocketride-app
npx rocketride init --uri https://api.rocketride.ai   # once; needs ROCKETRIDE_APIKEY
cd apps/openstate && pnpm build                        # tsc gate + rsbuild
cd ../.. && npx rocketride app verify ./apps/openstate
npx rocketride app deploy ./apps/openstate --comment "v1" --uri https://api.rocketride.ai --apikey $ROCKETRIDE_APIKEY
```

Deploying needs a registered developer id: claim one on the App Builder's
Deploy tab (letters and underscores), then set `appManifest.id` in
`apps/openstate/package.json` and `id` in `src/AppDescriptor.ts` to
`<developerId>.openstate` and rename the setting key to match.

Use pnpm here, never npm. The root `npm run lint` and `npx tsc` skip this
folder; it has its own type gate in `pnpm build`.
