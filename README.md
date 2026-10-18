# archive-hlc

## أرشيف هاتف ليبيا الإلكتروني — Archive System for HLC

نظام أرشيف إلكتروني ثابت (Static) بواجهة عربية تدعم الاتجاه من اليمين إلى اليسار (RTL)،
مبني بـ HTML وCSS وJavaScript فقط دون أي إطار عمل أو خطوة بناء أو طلبات خارجية.

A plain static Arabic RTL single-page app for archiving Hatif Libya correspondence
and documents. No frameworks, no build step, no CDN — it runs fully offline.

## Project structure

```
.
├── index.html      # Application markup (all pages, modal, login screen)
├── css/
│   └── style.css   # Styles: light/dark themes via CSS custom properties
├── js/
│   ├── theme.js    # Theme controller (System / Dark / Light segmented toggle)
│   └── script.js   # App logic (documents, departments, login, export)
├── img/
│   └── logo.svg    # Logo / favicon
└── README.md
```

## Run locally

Serve the folder with any static file server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

> Opening `index.html` directly via `file://` also works for browsing, but a local
> server is recommended so relative asset paths behave exactly as in production.

## Theme (Dark / Light)

- Three modes: **النظام** (System) / **داكن** (Dark) / **فاتح** (Light); default is System.
- The choice is stored in `localStorage` under the key `hlc-theme` and persists across
  reloads and login/logout.
- In System mode the app follows `prefers-color-scheme` and updates live when the
  operating system setting changes.
- An inline script in `<head>` applies the saved theme before first paint (no flash).
- The toggle appears on the login screen, in the top bar, and in the Settings page;
  all instances stay in sync.
- Printing always uses a light scheme regardless of the active theme.

## Demo login

This prototype uses a demo-only login (no real security): the login screen is always
shown on page load. Demo accounts:

| Username   | Password | Role             |
| ---------- | -------- | ---------------- |
| `admin`    | `1234`   | مدير النظام      |
| `employee` | `1234`   | موظف الأرشيف     |

## Data storage

All data lives in the browser's `localStorage`:

- `hl_archive_data_v1` — documents (المعاملات)
- `hl_archive_departments_v1` — departments (الإدارات)
- `hlc-theme` — theme preference

Backup/restore of documents and departments is available from the Settings page
(JSON export/import).
