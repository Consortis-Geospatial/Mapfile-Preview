# MapFile Preview

## 1. Project Overview

**MapFile Preview** is a browser-based tool that helps you **edit MapServer mapfiles** and **immediately preview what they publish** (WMS/WFS). It includes a UI for editing text and viewing the map, and an API service that reads/writes mapfiles from a workspace folder, validates them with MapServer, and forwards preview requests to your MapServer installation.

## 2. Features

- Edit MapServer `.map` files from a configured workspace folder
- Create new mapfiles (guided form) or “Quick New” templates
- Save / Save As to manage mapfiles and aliases in the workspace
- Format (pretty-print) mapfiles for readability
- Validate mapfiles with MapServer and show errors/warnings
- Auto Metadata helper (adds common OGC metadata for WMS/WFS/WCS)
- Preview:
  - **WMS** (GetMap / GetLegendGraphic / Capabilities)
  - **WFS** (choose a layer and preview features on the map)
  - **CGI** smoke test
- **Mapfile Teacher (Gemini)**: ask questions and get answers grounded in the MapServer PDF (requires your own Gemini API key)

### Feature details (what each one does)

**Open mapfile (by alias + path).**  
Opens an existing `.map` file from the workspace by letting you assign (or re-use) a short alias (e.g., `MY_MAP`) and a relative path inside the workspace (e.g., `subfolder/my_map.map`). The alias is used for previews so you don’t have to type long file paths.

**New / Quick New mapfile.**  
Creates a new mapfile for you using a guided form. “New” lets you fill in more options (projection/EPSG, map size, extent, optional paths, and service metadata), while “Quick New” creates a fast starter mapfile with minimal inputs so you can begin editing immediately.

**Save / Save As.**  
Saves your current changes back to the workspace. “Save As” helps you store the mapfile under a new file name and optionally in a chosen folder inside the workspace, with an option to overwrite if a file already exists.

**Format mapfile.**  
Reformats the mapfile text so it is easier to read and review (consistent indentation and structure). This reduces mistakes caused by messy formatting and makes troubleshooting easier.

**Validate mapfile.**  
Runs MapServer’s validation on the mapfile and returns any errors or warnings. This is the quickest way to confirm whether the mapfile can be parsed and whether common configuration problems exist before you try to publish services.

**Auto Metadata.**  
Helps you add (or generate) common OGC-related metadata blocks for `WEB/METADATA` or `LAYER/METADATA`. You can choose which capabilities to include (OWS/WMS/WFS/WCS), and the tool prepares a ready-to-insert metadata snippet so you don’t have to write it from scratch.

**WMS Preview.**  
Lets you test WMS output quickly: view maps, legends, and capabilities. The preview uses your MapServer endpoint and the currently opened mapfile, so you can immediately see if style/extent/projection changes behave as expected.

**WFS Preview (Layer Picker).**  
Helps you test WFS layers by listing the available layers and letting you choose one to preview. This is useful when a service exposes many layers—pick a single layer and view its features on the map to confirm geometry and attributes look correct.

**CGI Smoke Test.**  
Performs a basic check against the MapServer CGI endpoint to confirm it is reachable and responding. This is useful when previews fail and you want to quickly distinguish “MapServer is down/unreachable” from “mapfile/config issue”.

**Mapfile Teacher (Gemini).**  
A “chat-like” helper where you ask MapServer/mapfile questions and get answers grounded in a PDF reference. For best results, download **MapServer.pdf** from the official MapServer documentation page and point the Teacher to the local file path. The Teacher requires **your own personal Gemini API key** (see Configuration).

MapServer documentation page (download **MapServer.pdf** there):
```text
https://mapserver.org/documentation.html
```

## 3. Architecture (High-level)

- **UI (Frontend)**  
  Provides the editor, dialogs (open/save/new), and the preview map. It calls the API (default: `http://localhost:4300`) for file operations, validation, and previews.

- **API (Backend)**  
  Reads/writes mapfiles from a workspace folder, validates them, stores settings, and forwards WMS/WFS/CGI preview requests to your MapServer endpoint.

- **MapServer (External requirement)**  
  - A **local MapServer binary** (`mapserv`) for validation
  - A **MapServer CGI endpoint** reachable over HTTP for WMS/WFS previews (e.g., served via IIS/Apache)

## 4. Prerequisites

- **Node.js:** Not specified in repository (recommend **Node 18+**)
- **Package manager:** **npm** (package-lock files present)
- **External services / software:**
  - **MapServer** (required)
    - Local `mapserv` binary path (for validation)
    - HTTP base URL for MapServer CGI (for preview)
  - **Mapfile Teacher (optional):**
    - A **personal Gemini API key** (required to use Teacher)

## 5. Installation

### Get the project files (ZIP or Git)

**Option A — ZIP**
```bash
unzip Mapfile-Preview.zip
cd Mapfile-Preview
```
The ZIP file can be found at https://github.com/Consortis-Geospatial/Mapfile-Preview/
 under the **Code** tab.
<img width="1004" height="649" alt="image" src="https://github.com/user-attachments/assets/5fe456a8-0bc0-41b2-a25b-1aec971a9239" />

Alternatively, you can use the releases listed in the Releases section on the right side of the GitHub page.
<img width="750" height="430" alt="image" src="https://github.com/user-attachments/assets/db0f16ce-f7a3-490f-b81a-be0a3bf29e5f" />

Once you click Releases, it will open and you can choose the version you want. For example:
<img width="750" height="361" alt="image" src="https://github.com/user-attachments/assets/20dee738-f058-4372-a4d3-bd012510b8e9" />


**Option B — GIT**
```bash
git clone <REPOSITORY_URL>
cd <REPOSITORY_FOLDER>
```

## Install dependencies

These steps download all required packages for the project.

### Before you start
- **Windows:** Open **Command Prompt** as **Administrator**.
- Go to the folder where you **unzipped** the project:
  1. In the Command Prompt, type `cd ` (with a space at the end)
  2. Drag & drop the unzipped project folder into the Command Prompt window (it will paste the full path)
  3. Press **Enter**

### Install dependencies (UI + API)

UI:

```bash
cd client
npm ci
```

API:

```bash
cd ../server
npm ci
```

> If `npm ci` fails (e.g., lockfile mismatch), use `npm install`.

## 6. Configuration

Most day-to-day usage is done through the app’s **Settings** (where available). If you run the app yourself, the API also supports configuration via environment variables and an optional local JSON file.

### How configuration is loaded (API)

Configuration is applied in this order (highest priority first):

1. `server/src/config.local.json` (if present)
2. Environment variables
3. Built-in defaults

### API settings (recommended values)

You’ll typically configure these so the app can find your workspace and your MapServer installation.

#### API environment variables

| Variable | What it controls | Example |
|---|---|---|
| `PORT` | API listening port | `4300` |
| `WORKSPACE_DIR` | Folder where mapfiles are stored (read/write) | `C:\data\maps` |
| `CURRENT_MAP` | Default mapfile to open (full path) | `C:\data\maps\example.map` |
| `CURRENT_MAP_ALIAS` | Default alias used for preview | `MY_MAP` |
| `USE_MAP_ALIAS` | If `1`, previews use `map=<alias>`; if `0`, use full map path | `1` |
| `MAPSERV_PATH` | Local path to `mapserv` binary (validation) | `C:\mapserver8\bin\mapserv.exe` |
| `MAPSERV_URL` | Base URL of MapServer CGI endpoint (previews) | `http://localhost:8080/mapserver-8` |
| `MAPSERVER_CONF` / `MAPSERVER_CONFIG_FILE` | Path to MapServer config file (used for alias-related configuration) | `C:\data\maps\mapserver.conf` |

#### Mapfile Teacher (Gemini) requirements

To use **Mapfile Teacher**, you must provide:

1. **A local PDF path** (recommended: the official **MapServer.pdf** you downloaded)  
2. **Your own personal Gemini API key**

Gemini key can be provided as:
- Environment variable `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), **or**
- In `server/src/config.local.json` under `llm.geminiApiKey`

> Keep your API key private. Do not commit it to source control.

#### `server/src/config.local.json` (optional)

This file is for local overrides and may also be written by the app’s Settings screen (if enabled).

Example:

```json
{
  "port": 4300,
  "workspaceDir": "C:\\data\\maps",
  "mapservPath": "C:\\mapserver8\\bin\\mapserv.exe",
  "mapservUrl": "http://localhost:8080/mapserver-8",
  "useMapAlias": true,
  "currentMapAlias": "MY_MAP",
  "llm": {
    "enabled": true,
    "typeLLM": "Gemini",
    "geminiApiKey": "YOUR_PERSONAL_KEY"
  },
  "geminiMpTeacher": {
    "pdfPath": "C:\\path\\to\\MapServer.pdf",
    "model": "gemini-2.5-flash",
    "topK": 6
  }
}
```

### UI configuration


- **API base URL:** defaults to `http://localhost:4300`
- **Theme / language / Teacher PDF path:** stored in the browser (local preferences)

If you run the API on a different host/port, make sure the UI is configured (or deployed behind a proxy) to reach the API correctly.

## 7. Running the App (Dev / Prod)

### Development (two terminals)

You will run the project in **two separate terminal windows**:
- **API (server)** runs in one terminal
- **UI (client)** runs in another terminal

> Tip: Keep both terminals open while you use the app.

---

#### 1) Open Terminal #1 (API)
- **Windows:** Open **Command Prompt** as **Administrator**.

Go to the **project root folder** (the folder that contains `client` and `server`):
1. Type `cd ` (with a space)
2. Drag & drop the project folder into the terminal (it pastes the full path)
3. Press **Enter**

Start the API:

```bash
cd server
npm start
```

What to expect:
- The terminal will stay “busy” and show logs. That’s normal.
- Leave this window open.

---

#### 2) Open Terminal #2 (UI)
- **Windows:** Open a **second** Command Prompt as **Administrator**.

Again, go to the **same project root folder** (the one that contains `client` and `server`).

Start the UI:

```bash
cd client
npm start
```

What to expect:
- The UI will start and the terminal will keep running.
- Leave this window open too.

---

#### 3) Open the app in your browser

Default URLs:
- UI: `http://localhost:4200`
- API: `http://localhost:4300`

Usually you only need to open the **UI** link. The UI will talk to the API in the background.

---

#### 4) How to stop the app
In **each** terminal window, press:

- `Ctrl + C`

(Windows may ask for confirmation — if it does, type `Y` and press Enter.)

### Production

#### API

```bash
cd server
npm start
```

#### UI (static build)

```bash
cd client
npm run build
```

Build output:
- `client/dist/client/browser`

Serve the UI build with any static web server (Nginx/IIS/etc.).

#### UI (SSR build, optional)

```bash
cd client
npm run build
PORT=4000 npm run serve:ssr:client
```

## 8. Scripts

### UI (`client/package.json`)

- `npm start` — run the UI in development
- `npm run build` — build for production
- `npm run watch` — build in watch mode (development configuration)
- `npm test` — run UI tests
- `npm run serve:ssr:client` — run the built SSR server

### API (`server/package.json`)

- `npm run dev` — start the API
- `npm start` — start the API

## 9. Project Structure

```text
.
├─ client/          # UI (editor + map preview)
├─ server/          # API (workspace, validation, WMS/WFS/CGI proxy, Teacher)
├─ workspace/       # Local workspace artifacts (e.g., logs)
└─ zip_project.bat  # Helper script (if used in your environment)
```
