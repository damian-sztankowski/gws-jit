# Tasks - Keyless DWD & Workload Identity Federation

- [x] Update types files (both backend and frontend `types.ts`) to include `serviceAccountEmail`.
- [x] Add `serviceAccountEmail` to DEFAULT_DB and db.json parsing/migration logic in `backend/src/db.ts`.
- [x] Implement keyless DWD auth handling (IAM signJwt + token exchange) in `backend/src/google.ts`.
- [x] Update backend API routes in `backend/src/index.ts` to support reading/writing `serviceAccountEmail`.
- [x] Redesign frontend System Config and Spaces panels in `frontend/src/components/Settings.tsx` to support configuring keyless Service Account Emails.
- [x] Verify build and compilation using `npm run build`.
- [x] Synchronize and document the changes in a walkthrough.
