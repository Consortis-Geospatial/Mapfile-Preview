# MapFile Preview

## 1. Project Overview

**MapFile Preview** is a browser-based tool that helps you **edit MapServer mapfiles** and **immediately preview what they publish** (WMS/WFS). It includes a UI for editing text and viewing the map, and an API service that reads/writes mapfiles from a workspace folder, validates them with MapServer, and forwards preview requests to your MapServer installation.

<img width="1000" height="246" alt="image" src="https://github.com/user-attachments/assets/d0803ac2-e27a-47f5-91d1-36d6ebde7975" />

## 2. Features

- Edit MapServer `.map` files from a configured workspace folder
- Create new mapfiles (guided form) or “Quick New” templates
- Save / Save As to manage mapfiles and aliases in the workspace
- Format (pretty-print) mapfiles for readability
- Validate mapfiles with MapServer and show errors/warnings
- Auto Metadata helper (adds common OGC metadata for WMS/WFS)
- Preview:
  - **WMS** (GetMap / GetLegendGraphic / Capabilities)
  - **WFS** (choose a layer and preview features on the map)
- **Mapfile Teacher (Gemini)**: ask questions and get answers grounded in the MapServer PDF (requires your own Gemini API key)

### Feature details (what each one does)

**Open mapfile (by alias + path).**  
Opens an existing `.map` file from the workspace by letting you assign (or re-use) a short alias (e.g., `MY_MAP`) and a relative path inside the workspace (e.g., `subfolder/my_map.map`). The alias is used for previews so you don’t have to type long file paths.

**New / Quick New mapfile.**  
Creates a new mapfile for you using a guided form. “New” lets you fill in more options (projection/EPSG, map size, extent, optional paths, and service metadata), while “Quick New” creates a fast starter mapfile with minimal inputs so you can begin editing immediately.

<img width="900" height="445" alt="image" src="https://github.com/user-attachments/assets/2f86da8c-5058-403f-9fb2-b58467521038" />

**Save / Save As.**  
Saves your current changes back to the workspace. “Save As” helps you store the mapfile under a new file name and optionally in a chosen folder inside the workspace, with an option to overwrite if a file already exists.

**Format mapfile.**  
Reformats the mapfile text so it is easier to read and review (consistent indentation and structure). This reduces mistakes caused by messy formatting and makes troubleshooting easier.

**Validate mapfile.**  
Runs MapServer’s validation on the mapfile and returns any errors or warnings. This is the quickest way to confirm whether the mapfile can be parsed and whether common configuration problems exist before you try to publish services.

<img width="900" height="448" alt="image" src="https://github.com/user-attachments/assets/b3db105f-8b62-4705-bb0c-90bddcf7d159" />

**Auto Metadata.**  
Helps you add (or generate) common OGC-related metadata blocks for `WEB/METADATA` or `LAYER/METADATA`. You can choose which capabilities to include (OWS/WMS/WFS/WCS), and the tool prepares a ready-to-insert metadata snippet so you don’t have to write it from scratch.

**WMS Preview.**  
Lets you test WMS output quickly: view maps, legends, and capabilities. The preview uses your MapServer endpoint and the currently opened mapfile, so you can immediately see if style/extent/projection changes behave as expected.

**WFS Preview (Layer Picker).**  
Helps you test WFS layers by listing the available layers and letting you choose one to preview. This is useful when a service exposes many layers—pick a single layer and view its features on the map to confirm geometry and attributes look correct.

**Mapfile Teacher (Gemini).**  
A “chat-like” helper where you ask MapServer/mapfile questions and get answers grounded in a PDF reference. For best results, download **MapServer.pdf** from the official MapServer documentation page and point the Teacher to the local file path. The Teacher requires **your own personal Gemini API key** (see Configuration).

MapServer documentation page (download **MapServer.pdf** there):
```text
https://mapserver.org/documentation.html
```
<img width="900" height="447" alt="image" src="https://github.com/user-attachments/assets/c8e7f1be-0cd7-41b7-95fb-8c38c9bde93b" />

## 3. Architecture (High-level)

- **UI (Frontend)**  
  Provides the editor, dialogs (open/save/new), and the preview map. It calls the API (default: `http://localhost:4300`) for file operations, validation, and previews.

- **API (Backend)**  
  Reads/writes mapfiles from a workspace folder, validates them, stores settings, and forwards WMS/WFS/CGI preview requests to your MapServer endpoint.

- **MapServer (External requirement)**  
  - A **local MapServer binary** (`mapserv`) for validation
  - A **MapServer CGI endpoint** reachable over HTTP for WMS/WFS previews (e.g., served via IIS/Apache)

## 4. Prerequisites

- **Node.js:** recommend **Node 20+** (https://nodejs.org/en/blog/release/v20.20.0)
- **Package manager:** **npm** (package-lock files present)
- **External services / software:**
  - **MapServer 8+** (required)
    - Local `mapserv` binary path (for validation)
    - HTTP base URL for MapServer CGI (for preview)
  - **Mapfile Teacher (optional):**
    - A **personal Gemini API key** (required to use Teacher - (https://ai.google.dev/gemini-api/docs/api-key))

## 5. Installation

> **Installation at a glance** — do these steps in order:
> 1. **Install MapServer** (required for validation & preview) — see *Step 1* below.
> 2. **Install Node.js 20+** (this also installs **npm**); for the Git option also install **Git** — see [Prerequisites](#4-prerequisites).
> 3. **Get the project files** (ZIP or Git) — *Step 2*.
> 4. **Install dependencies** (UI + API) — *Step 3*.
>
> When done, continue to **6. Configuration** and **7. Running the App (Dev)**.

### Step 1 — Install MapServer (required)

The app needs MapServer for two separate things:
- a **local `mapserv` binary** (e.g. `mapserv.exe`) used for **validation** → later set as `MAPSERV_PATH`
- a **MapServer CGI endpoint over HTTP** (served by a web server) used for **WMS/WFS preview** → later set as `MAPSERV_URL`

On Windows the easiest option is **MS4W**, because one installer provides **both** the `mapserv.exe` binary **and** a ready web server with a CGI endpoint (no manual IIS/Apache setup needed).

**Option A — MS4W (recommended for Windows)**
- Home / docs: https://ms4w.com/
- Download page: https://ms4w.com/download.html
- Direct installer (.exe): https://ms4w.com/release/ms4w-5.2.0-setup.exe
- Install guide (README): https://ms4w.com/README_INSTALL.html

> After installing MS4W, the binary is typically at `C:\ms4w\Apache\cgi-bin\mapserv.exe` and the CGI endpoint at `http://localhost/cgi-bin/mapserv.exe`. Use **your actual path/URL** in *6. Configuration* (`MAPSERV_PATH` / `MAPSERV_URL`) — they may differ from the example defaults.

**Option B — OSGeo4W** (select the **mapserver** package during setup)
- Project page: https://www.osgeo.org/projects/osgeo4w/
- Network installer: https://download.osgeo.org/osgeo4w/v2/osgeo4w-setup.exe

**Official MapServer pages**
- Download: https://mapserver.org/download.html
- Installation docs: https://mapserver.org/installation/index.html

> Need **MapServer.pdf** for the optional *Mapfile Teacher*? Direct download: https://download.osgeo.org/mapserver/docs/MapServer.pdf

### Step 2 — Get the project files (ZIP or Git)

**Option A — ZIP**

> **Windows users:** the `unzip` command below is for macOS/Linux. On Windows, **right-click the downloaded `.zip` → Extract All…**, then open the extracted folder.

```bash
unzip Mapfile-Preview.zip
cd Mapfile-Preview
```
The ZIP file can be found at https://github.com/Consortis-Geospatial/Mapfile-Preview/
 under the **Code** tab.
<img width="600" height="554" alt="image" src="https://github.com/user-attachments/assets/5fe456a8-0bc0-41b2-a25b-1aec971a9239" />

Alternatively, you can use the releases listed in the Releases section on the right side of the GitHub page.
<img width="750" height="430" alt="image" src="https://github.com/user-attachments/assets/db0f16ce-f7a3-490f-b81a-be0a3bf29e5f" />

Once you click Releases, it will open and you can choose the version you want. For example:
<img width="750" height="361" alt="image" src="https://github.com/user-attachments/assets/20dee738-f058-4372-a4d3-bd012510b8e9" />


**Option B — Git (recommended)**
Clone the repository to get the latest code (requires **Git** installed — download it from https://git-scm.com/download/win), then enter the project folder:

```bash
git clone https://github.com/Consortis-Geospatial/Mapfile-Preview.git
cd Mapfile-Preview
```

### Step 3 — Install dependencies

These steps download all required packages for the project.

#### Before you start
- **Windows:** Open **Command Prompt** as **Administrator**.
  1. Click Start (or press the Windows key)
  2. Type cmd or Command Prompt
  3. Right-click Command Prompt → Run as administrator
- Go to the **project root folder** — the folder you **unzipped/cloned** that contains both `client` and `server`:
  1. In the Command Prompt, type `cd ` (with a space at the end)
  2. Copy and paste the folder path into the Command Prompt window
  3. Press **Enter**

> **Tip:** Run the UI and API commands below **in sequence, in the same terminal**, starting from the project root (the `cd ../server` step assumes you just ran the `cd client` step). Administrator rights are usually only needed if you hit a permission error.

#### Install dependencies (UI + API)

UI:

```bash
cd client
npm ci
```
<img width="431" height="119" alt="image" src="https://github.com/user-attachments/assets/e514aa8f-efcc-435a-9c83-0368f0186fe2" />

API:

```bash
cd ../server
npm ci
```
<img width="395" height="93" alt="image" src="https://github.com/user-attachments/assets/88f826c8-4f3a-4383-90e0-9df52231b745" />

> If `npm ci` fails (for example, you see a red **lockfile mismatch** error), run `npm install` instead.

## 6. Configuration

Most day-to-day usage is done through the app’s **Settings** (where available). If you run the app yourself, the API also supports configuration via environment variables and an optional local JSON file.

### How configuration is loaded (API)

Configuration is applied in this order (highest priority first):
1. `server/src/config.local.json` (if present)


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

The UI is configured via a small JSON file (e.g., `config.json`) and browser-local preferences.

Example `config.json`:
```json
{
  "language": "el",
  "theme": "light",
  "use_AI": true,
  "apiURL": "http://localhost:4300"
}
```

- **apiURL:** base URL of the API backend (default: `http://localhost:4300`)
- **language / theme / use_AI:** UI defaults
- **Teacher PDF path (and some other preferences):** stored in the browser (local preferences)

If you run the API on a different host/port, update `apiURL` (or deploy the UI behind a proxy) so the UI can reach the API correctly.

## 7. Running the App (Dev)

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

You only need to open the **UI** link. The UI will talk to the API in the background.

---

#### 4) How to stop the app
In **each** terminal window, press:

- `Ctrl + C`

(Windows may ask for confirmation — if it does, type `Y` and press Enter.)

## 8. Project Structure

```text
.
├─ client/          # UI (editor + map preview)
├─ server/          # API (workspace, validation, WMS/WFS/CGI proxy, Teacher)
├─ workspace/       # Local workspace artifacts (e.g., logs)
└─ zip_project.bat  # Helper script (if used in your environment)
```
