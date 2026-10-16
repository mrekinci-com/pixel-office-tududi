# Pixel Office / Tududi compatibility contract

This contract is based on the earlier read-only review of `ofis/server/tududi.ts`, `tududi-access.ts`, `tududi-proxy.ts`, `proxy-index.ts`, and `docker-compose.yml` in the neighboring [Pixel Office repository](https://github.com/mrekinci-com/pixel-office). That review did not change its files or send requests to running applications. Some capabilities also exist in upstream Tududi; all are part of the contract used by Pixel Office.

This fork is maintained at [pixel-office-tududi](https://github.com/mrekinci-com/pixel-office-tududi).

## Connection and identity

| Dependency | Preserved behavior / rationale |
| --- | --- |
| Internal address and port | The office client uses `http://127.0.0.1:9393`. Tududi runs with `PORT=9393`; the office shares its network namespace. |
| Proxy Host header | `tududi-proxy.ts` forwards HTTP requests with `Host: 127.0.0.1:9393`. This exact value continues to pass the private access gate. Changing the hostname or port does not grant the private exception. |
| `PANEL_ACCESS_ENABLED=false` | Preserves the office's existing configuration: no external identity provider is required; local Host values pass, external Host values receive 503. The configured-port exception also covers health checks. |
| `TUDUDI_ALLOWED_ORIGINS` | Proxy and office browser origins are configured in the deployment environment. No personal address is embedded in the code; the list does not relax the Host gate. |
| `RATE_LIMIT_AUTH_MAX=300` | Office agent accounts log in frequently. The environment variable is preserved; the default login limit is unchanged. |
| HTTPS / SSL | The neighboring Compose configuration uses HTTP internally and sets `TUDUDI_INTERNAL_SSL_ENABLED=false`. This fork's Node server has no separate TLS handler under that variable name. The HTTP server and health check are preserved. |
| Login | `POST /api/login` accepts `{email,password}` and returns `Set-Cookie`. The office caches the administrator cookie, logs in again after 401, and backs off after 429. |
| Browser account handoff | `tududi-access.ts` passes the Tududi cookie from normal login to the browser. The cookie name, root path, HttpOnly/SameSite behavior, and absence of Secure on local HTTP are preserved. The office fallback login link sends an `email` query parameter; the current login page requires the email to be entered manually. |
| Proxy headers | The office proxy passes authentication, origin, and Tududi cookies. It strips its own office cookie and external identity/forwarding headers, preserving the private local exception. |
| API key | An authenticated session calls `POST /api/profile/api-keys` with a name such as `{name:"Pixel Office"}`; the response exposes the plaintext `token` once. Subsequent requests support `Authorization: Bearer …`. |
| Versioned endpoints | Both `/api` and `/api/v1` registrations are preserved. The office uses unversioned `/api` paths. |

## User, task, project, and note endpoints

| Usage | Preserved endpoint / response |
| --- | --- |
| Find administrator-managed users | `GET /api/admin/users`; an array with numeric `id`, email, and role. Regular users cannot access administrator operations. |
| Create agent account | `POST /api/admin/users`, `{email,password,name,surname}`; `id` is returned directly in the user object. Conflicts return 409. Administrator-created accounts can log in normally. |
| Update/delete account | `PUT /api/admin/users/:id` supports partial email/password updates; `DELETE /api/admin/users/:id` removes the account and its relations. Last-administrator protection is preserved. The model hook includes the password hash in the persisted fields for password-only updates, fixing the earlier successful response without a saved password. Successful deletion returns 204 with an empty body. |
| Language / time zone | `GET /api/profile` and `PATCH /api/profile` support `language: "tr"` and `timezone`. The default user language remains English (`en`). |
| Read records | `GET /api/projects`, `GET /api/notes`, `GET /api/tasks?type=all&client_side_filtering=true`. The task list contains `tasks`; projects retain `uid`, and tasks/notes retain `project_id` or their project relation. The office derives `project_uid` from these relations. |
| Create task | `POST /api/task`, `{name,note,project_uid}`. The office maps its `description` field to Tududi's `note`. |
| Update task | `PATCH /api/task/:uid`; partial `name`, `note`, numeric `status`, and `project_uid` are accepted. **Omitting status preserves the current status**; editing a name/note/date does not reopen a completed task. |
| Create/update note | `POST /api/note`, `PATCH /api/note/:uid`; `title`, `content`, `project_uid`. Summary publishing finds and updates the note for the same day/project, or creates it when absent. |
| Create/update project | `POST /api/project`, `PATCH /api/project/:uid`; `name` and optional `description`. Responses retain `uid`. |
| Search | `GET /api/search?q=…&project_uid=…`; API key and user scope are preserved. |
| Isolation | One agent's API key cannot read or change another agent's private tasks, notes, or projects. Existing permission tests are preserved. |

## Preserved fork improvements

- A 90-day upcoming task window, localized day headings, calendar/agenda views, and drag-to-reschedule dates.
- Dates in the application language, note sorting, and completion/reopening confirmation.
- Notification read state, an unread-only bell list, and marking old notifications read when a task is completed, archived, deleted, or moved to a later date.
- The data model, UIDs, sharing/permission behavior, administrator account management, and API keys.

The terminal page, project panel, terminal uploads, and clipboard transfer have been removed. The office client does not depend on them. The office proxy's generic WebSocket upgrade handling remains in the neighboring project; this edition has no terminal WebSocket server.

## Deployment steps

The release owner should change the image in the Pixel Office repository to `pixel-office-tududi:0.87-po.4`, preserving its network arrangement, `.env` files, and database/upload mounts. This repository's changes do not update the neighboring Compose configuration or start containers.

For standard standalone use, leave the panel variable unset. Office deployments that require the existing private access behavior should keep an explicit `PANEL_ACCESS_ENABLED=false`. The optional external panel now uses generic JWT/JWKS configuration; old provider-specific settings alone are insufficient. See the [English README](../README.md#access-settings) or [Turkish README](../README.tr.md#erişim-ayarları).

## Verification scope

Existing Jest tests cover administrator users, API keys, user permissions, note/project operations, notifications, and partial updates. The additional [compatibility scenario](../backend/tests/integration/pixel-office-compatibility.test.js) exercises administrator-created agent accounts, API key generation, a Turkish profile, project/task/note workflows, and status preservation together. Separate panel tests cover the exact local Host exception, closed external access, and real RSA signature verification.

Live office integration, a real identity provider, upgrades against an existing database, and image runtime behavior require separate deployment validation. Local handoff and task notes are excluded from published artifacts.
