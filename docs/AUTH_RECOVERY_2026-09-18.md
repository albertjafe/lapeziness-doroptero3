# Account verification after v411

The owner's iPad screenshot reports `AUTH_TIMEOUT` while checking the account. Cloud checks still showed 77 minutes rather than the local 366 minutes. At about 20:40 UTC, even a management SQL `SELECT 1` and public Auth/REST checks timed out; at 20:44 UTC SQL resumed and the Auth health endpoint returned 200. This is evidence of a transient access problem, not proof that every iPad timeout has the same cause. The actual device's SDK version was not available.

Settings had a separate confirmed bug: it discarded `getUser().error`, presenting a failed verification as an absent session. v412 checks the returned error and bounds these UI reads without changing an in-progress synchronization diagnostic. A genuine `AuthSessionMissingError` still offers account connection; retryable errors do not say the owner signed out.

The former floating CDN import `@supabase/supabase-js@2` was replaced by the unchanged browser bundle for 2.116.0, the version served by that CDN and published in the npm registry during verification. It is now served by the app and precached alongside the main script. No custom lock, token reader, second client, auth reset or independent document writer was added. The existing `piano_auth_v1` storage key, validated account, CAS merges and RLS remain in use.

Bundle provenance: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0

SHA-256: `fbde52aab1700a3b308087ae78b41fb5192e7a952d81d5d08238763ce3245dd8`. MIT license is included in `supabase-sdk-LICENSE.txt`. Upstream release: https://github.com/supabase/supabase-js/releases/tag/v2.116.0. Upstream describes its default refresh coordination in https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/migrations/lockless-coordination.md; the app uses these defaults rather than bypassing or stealing locks.

`real-sdk-cloud-sync.spec.js` runs the real bundled SDK, expired persisted sessions, a simulated Auth 503, an occupied legacy lock, and independent iPad/phone contexts. Only HTTP responses are simulated. It checks token rotation, authenticated PostgREST requests, preserved pending study, confirmed upload and phone download. The offline PWA test now also requires the SDK to remain available after reload. These tests do not demonstrate that the owner's actual iPad copy has reached production; that needs a real cloud check after device synchronization.
