# NFC Catalog

A React single-page app for building a private, visual catalog of items linked to NFC tags. Each entry has a name, code, collection, description, an image gallery, a theme (accent colour + background pattern), and a set of typed links (wiki, video, shop, etc.). Scanning an NFC tag — or its QR code fallback — opens the browser straight to that one entry via an unguessable token URL.

The catalog is backed by **Supabase** (Postgres + auth + storage). Managing the catalog requires logging in; the **only** thing the public can reach is a single entry via its exact `#/e/<token>` link. There is no public browsing or listing — visitors can't enumerate or discover other entries. Access is enforced server-side: anonymous users can only call a locked-down database function that returns one entry by exact id, and all table writes require being the authenticated owner.

Entries support multiple images (gallery with thumbnails and a lightbox), per-collection shared themes that entries opt into, QR codes (with PNG download), and direct tag writing via the Web NFC API. Built with Vite + React 18; QR codes via the `qrcode` package.

**First-time backend setup is in [`SETUP.md`](./SETUP.md)** — create the Supabase project, run the provided SQL, and paste your credentials into `src/config.js`.

## How to run

**Development:**
```
npm install
npm run dev
```
Open the printed URL, then sign in with the admin user you created in Supabase. (Requires `src/config.js` to be filled in — see SETUP.md.)

**Production build:**
```
npm run build
npm run preview
```
The `dist/` folder is a static site. The included GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and deploys it to GitHub Pages automatically on every push to `main` — set the repo's Pages source to "GitHub Actions" to enable it.

**NFC tags:** each entry's detail page shows its `#/e/<token>` URL — program that onto a tag, or use the NFC tab to write it directly. Set the public Base URL in the app's Settings tab so links point at your deployed site.

## Testing

1. **Login gate** — visit the site logged out; you should see a login screen, not the catalog.
2. **Sign in** — log in with your Supabase admin user; the catalog grid appears.
3. **Add entry** — open Manage (⚙), "New entry", fill in name/collection, pick a theme, add an image, and save. Confirm it uploads and appears in the grid.
4. **Edit / delete** — edit an entry's tagline and save; delete an entry and confirm it disappears.
5. **Public entry link** — open an entry, copy its `…#/e/<token>` link, and open it in an incognito window. It should show that one entry, read-only, with no nav or login.
6. **No enumeration** — in incognito, visit the site root; you should get the login screen with no way to browse entries.
7. **Search & collection filter** — confirm search and the folder drawer narrow the grid.
8. **QR code** — on an entry, "Show QR code" renders a QR in the accent colour; "Download PNG" saves it; scanning opens the entry.
9. **NFC write tab** — on Chrome for Android (HTTPS) each entry shows a "Write tag" button; elsewhere a graceful "not available" notice with copyable URLs.
10. **Multi-image gallery** — add 2+ images, reorder (first is Cover), save; confirm thumbnails + lightbox on the entry page and a count badge on the card.
11. **Collection theming** — set a theme in the Collections tab, then enable "Use collection theme" on an entry; confirm it adopts the collection's colours.
12. **JSON import** — Settings → Import JSON to push an exported catalog into the backend.

## Recently added

- **Supabase backend with login** ✓ — catalog stored in Postgres; managing it requires authentication.
- **Token-link privacy** ✓ — only direct `#/e/<token>` links are public; no browsing or enumeration.
- **Image storage** ✓ — entry images upload to a Supabase storage bucket.
- **GitHub Pages auto-deploy** ✓ — Actions workflow builds and publishes on push.
- **QR codes, NFC write, multi-image galleries, collection theming** ✓ — see earlier history.

## Suggestions for improvement

- **Signed image URLs** — serve images via short-lived signed URLs from a private bucket instead of a public one, so images are as protected as entries.
- **Published flag** — optionally mark some entries as openly listable on a public landing page while others stay token-only.
- **Batch QR export** — generate a printable sheet of QR codes for every entry at once.
- **Drag-and-drop image reordering** — replace the arrow buttons with drag-to-reorder.
- **Per-image captions** — let each gallery image carry a caption shown in the lightbox.
- **Orphaned image cleanup** — delete storage objects when an image is removed from an entry or an entry is deleted.
- **Bulk collection assignment** — move several entries between collections at once.
- **Multi-user / sharing** — invite additional editors, or per-collection ownership.
