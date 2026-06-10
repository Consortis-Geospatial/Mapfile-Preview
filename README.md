# MapFile Preview

> 🐳 **Easiest setup (for non-developers):** run the ENTIRE app with **one** command via Docker — **no** manual MapServer or Node.js install, and no two terminals. See **[Chapter 8 — Run with Docker](#docker)**.

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
> 2. **Install Node.js 20+** (this also installs **npm**) — detailed in *Step 3 → Part A* below; for the Git option also install **Git** (see [Prerequisites](#4-prerequisites)).
> 3. **Get the project files** (ZIP or Git) — *Step 2*.
> 4. **Install dependencies** (UI + API) — *Step 3 → Part B*.
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

### Step 3 — Install Node.js, then install the project's dependencies

This step has two parts:
- **Part A:** install **Node.js** (the engine that runs the project) and confirm it works.
- **Part B:** download the project's "building blocks" (the libraries it needs) for both the **UI** and the **API**.

> **A few words in plain language (no jargon needed):**
> - **Node.js** is the program that lets this project run on your computer. Installing it also installs **npm**, a helper that automatically downloads everything the project needs.
> - The **`client`** folder is the **UI** — the screen you look at and click. It is built with a technology called **Angular**. You do **not** install Angular by hand; npm does it for you in Part B.
> - The **`server`** folder is the **API** — the "engine" that works in the background (reading/saving mapfiles, talking to MapServer). It runs on **Node.js**.
> - You will set up **both** folders, one after the other.

#### Part A — Install Node.js (this also installs npm)

1. Open this page in your browser: https://nodejs.org/en/blog/release/v20.20.0 (or the Node.js home page https://nodejs.org/) and download the **Windows Installer (.msi)** for **version 20 or newer (the "LTS" version)**.
2. Run the downloaded file and click **Next** through the installer, leaving every option at its default. (Leave the **"Add to PATH"** option checked — it is on by default. This is what lets you type `node` in any window.)
3. When it finishes, click **Finish**. You do **not** need to restart the computer, but you **must** open a **new** Command Prompt window after installing (windows opened earlier won't know Node.js exists yet).

**Check that it worked.** Open a Command Prompt (Start → type `cmd` → press **Enter**) and type these two lines, pressing **Enter** after each:

```bash
node -v
npm -v
```

You should see a version number after each one — for example `v20.20.0` and `10.8.2`. The exact numbers may differ; that's fine, as long as Node is **20 or higher**. If instead you see **"'node' is not recognized"**, close the window, open a **new** Command Prompt, and try again. If it still fails, re-run the Node.js installer.

#### Part B — Download the project's dependencies (UI + API)

**First, open a Command Prompt inside the project's root folder.** The "root folder" is the one you unzipped/cloned in Step 2 that contains **both** the `client` and `server` folders.

1. Open a Command Prompt (Start → type `cmd` → press **Enter**). A normal (non-administrator) window is fine.
2. Type `cd ` — that is the two letters `c`, `d`, followed by a **space**.
3. Copy the full path of the project folder, paste it right after `cd `, and press **Enter**. (Tip: in File Explorer, click once on the address bar to reveal the full path, or simply **drag the project folder onto the Command Prompt window** to paste its path automatically.)

> **Important — run the two commands below in this order, in the SAME window.** First the UI, then the API. The API command uses `cd ../server`, which only works if you are coming from the `client` folder.

**1) UI (the Angular screen) — folder `client`:**

```bash
cd client
npm ci
```
<img width="431" height="119" alt="image" src="https://github.com/user-attachments/assets/e514aa8f-efcc-435a-9c83-0368f0186fe2" />

**2) API (the Node engine) — folder `server`:**

```bash
cd ../server
npm ci
```
<img width="395" height="93" alt="image" src="https://github.com/user-attachments/assets/88f826c8-4f3a-4383-90e0-9df52231b745" />

**What to expect while `npm ci` runs:**
- `npm ci` reads the project's list of required libraries and downloads them into a new folder called `node_modules`. (`ci` stands for "clean install".)
- It can take **several minutes** for each folder, especially the UI. You'll see many lines of text scrolling by — that's completely normal.
- It's **finished** when the scrolling **stops** and you get the prompt back (a line ending in `>` waiting for you to type). A short summary such as `added 1234 packages` means it worked. You can ignore yellow `npm warn` lines; only **red `npm error`** lines indicate a real problem.

> **Troubleshooting `npm ci`:**
> - **Red "lockfile" / "package-lock.json" mismatch error:** run this instead, in the same folder: `npm install`
> - **Permissions error** (e.g. `EPERM`, "access is denied"): close the window, reopen Command Prompt **as Administrator** (Start → type `cmd` → right-click **Command Prompt** → **Run as administrator**), go back to the project folder, and run the command again.
> - **"'npm' is not recognized":** Node.js isn't installed, or you opened the window before installing it — do **Part A** first, then open a **new** window.
> - **It hangs or fails to download:** `npm ci` needs the internet. Make sure you're online and try again.

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

You run the app every time you want to use it. It has **two parts that must both be running at the same time**, each in its **own** terminal window:
- **Terminal #1 → API** (the `server`, runs on **Node.js**) — the background engine.
- **Terminal #2 → UI** (the `client`, the **Angular** screen) — what you actually look at.

> **Why two windows?** Each part keeps running and "listens" for work, so it takes over its window and can't share it with the other. **Keep both windows open the whole time you use the app** — closing a window stops that part.

> **Order matters: start the API first, then the UI.** The UI needs the API to be ready to answer it.

---

#### 1) Terminal #1 — start the API (server / Node)

1. Open a Command Prompt (Start → type `cmd` → press **Enter**). A normal window is fine.
2. Go to the **project root folder** (the one that contains `client` and `server`): type `cd `, a **space**, then paste the folder path (or **drag the folder onto the window**) and press **Enter**.
3. Type these two lines, pressing **Enter** after each:

```bash
cd server
npm start
```

**What to expect:**
- After a moment you'll see a confirmation line, typically: **`Server on http://localhost:4300`**.
- The window then **stays open and looks "busy"** — it does **not** return to a normal prompt. **That is correct; it means the API is running. Leave this window open.**
- If it instead printed an error and gave you the prompt back, see **Troubleshooting** below.

---

#### 2) Terminal #2 — start the UI (client / Angular)

1. Open a **second, separate** Command Prompt window. (Don't reuse the first one — that window is busy running the API.)
2. Go to the **same project root folder** again (type `cd `, a space, paste the path, press **Enter**).
3. Type these two lines, pressing **Enter** after each:

```bash
cd client
npm start
```

**What to expect:**
- The UI is built with Angular, so the **first start takes a while** (often **30 seconds to a couple of minutes**) while it compiles. This is normal — please be patient and let it finish.
- When it's ready you'll see a green message similar to **"Application bundle generation complete"**, followed by a line like:
  - **`➜  Local:   http://localhost:4200/`**
- Like the API window, this window **stays open and busy**. **Leave it open too.**

---

#### 3) Open the app in your browser

Once Terminal #2 shows it's ready, open your web browser (Chrome, Edge, Firefox, …) and go to:

```text
http://localhost:4200
```

- **You only open the UI address (`4200`).** The UI talks to the API (`4300`) automatically in the background — you don't open `4300` yourself.
- If the page doesn't load on the very first try, wait a few seconds (the UI may still be finishing its compile) and then **refresh** the page.

---

#### 4) How to stop the app

When you're finished using the app:
1. Click on **Terminal #1**, then press **`Ctrl + C`** on the keyboard. If Windows asks **"Terminate batch job (Y/N)?"**, type **`Y`** and press **Enter**.
2. Do exactly the same in **Terminal #2**.
3. You can now close both windows.

> To use the app again another day, you do **not** need to reinstall anything from Section 5 — just repeat the steps in this section (start the API, then the UI, then open `http://localhost:4200`).

---

#### Troubleshooting (running the app)

| What you see | What it means | What to do |
|---|---|---|
| `'npm' is not recognized` | Node.js isn't installed, or the window was opened before installing it | Install Node.js (Section 5, Step 3 → **Part A**), then open a **new** Command Prompt and try again |
| `Missing script: "start"` or `Cannot find module …` | You're in the wrong folder, or dependencies weren't installed | Make sure you typed `cd server` / `cd client` first, and that you ran `npm ci` in Step 3 |
| A message that **port 4300** (API) or **port 4200** (UI) is **already in use** | The app — or another program — is already using that port | Close any old terminal windows that may still be running the app, then start again. If Angular offers to use a different port, you can accept it |
| Browser shows an error or "cannot reach the API" | The API (Terminal #1) isn't running, or you started the UI first | Make sure Terminal #1 is still open and shows `Server on http://localhost:4300`, then **refresh** the browser |
| A window seems "frozen" with logs and won't accept typing | This is **normal** — it's the running app, not a freeze | Don't type in that window; use the **other** window for commands. Press `Ctrl + C` there only when you want to **stop** that part |

<a id="docker"></a>
## 8. Run with Docker (easiest setup — no manual install)

> **Who this is for:** non-developers (or anyone who wants the fastest setup). This path lets you **skip Chapters 4–7**: you don't install MapServer, Node.js, or open two terminals. The only thing you install **once** is Docker Desktop.

### 8.1 Why Docker (the advantage)

Docker bundles the whole application — **UI + API + MapServer + web server** — into a single, ready-to-run image. In practice that means:

- **One install** (Docker Desktop) instead of three (MapServer + Node.js + Git), and no IIS/Apache setup.
- **One command** (`docker compose up`) — no `npm ci` in two folders, no two terminals kept open.
- **Nothing is installed on your computer** except Docker: MapServer and Node run *inside* the container and don't clutter your system.
- **Same result on every machine** (Windows/Mac/Linux) — no more "it worked on mine".
- **Clean removal:** a single `docker compose down` leaves nothing behind — no MapServer/Node to uninstall.

### 8.2 Step 1 — Install Docker Desktop (one time)

Download and install **Docker Desktop**:

- Download (all operating systems): **https://www.docker.com/products/docker-desktop/**
- Detailed install guide for **Windows**: **https://docs.docker.com/desktop/setup/install/windows-install/**
- General instructions (Mac/Linux): **https://docs.docker.com/get-docker/**

> After installing, **open Docker Desktop** and wait until you see the green **"Engine running"** at the bottom-left. That's all — no further configuration is needed.

### 8.3 Step 2 — Get the project files

Get the project files (exactly as in **Chapter 5 → Step 2**): either as a **ZIP** (**Code → Download ZIP** → right-click → *Extract All…*) or with **git clone**. Open the folder that contains `client`, `server`, and `docker-compose.yml`.

### 8.4 Step 3 — Start (one command)

1. Open a terminal **inside the project folder** (where `docker-compose.yml` lives):
   - **Windows tip:** in the File Explorer address bar, while inside the folder, type `cmd` and press **Enter** — this opens a terminal in exactly that folder.
2. Run:

   ```bash
   docker compose up -d --build
   ```

   - The **first time** it builds the image (downloads MapServer/Node, a few minutes — this happens **only once**).
   - `-d` runs it in the background (no need to keep a terminal open).

3. Open in your browser:

   ```text
   http://localhost:4300
   ```

   That's it. The UI **and** the API run on the **same** address (`4300`), so **no configuration is needed** — you only open this one link.

### 8.5 Where do I put my mapfiles and data?

In the project's **`workspace/`** folder (on your computer). It is mounted into the container as **`/data/maps`**, which means:

- Any `.map` file (together with the data it references: shapefiles, rasters, etc.) that you drop into `workspace/` is immediately visible to the app.
- On the first run an `example.map` is created automatically so you have something to open right away.

> ⚠️ **About paths:** inside the container the OS is Linux. So paths inside your mapfiles must be **relative** (e.g. `SHAPEPATH "."`) or Linux-style under `/data/maps` — **not** absolute Windows paths (e.g. `C:\data\...`). If a mapfile points to an external database (PostGIS), make sure it is reachable from the container.

### 8.6 Useful management commands

| What you want | Command |
|---|---|
| Start | `docker compose up -d` |
| Start after code changes | `docker compose up -d --build` |
| Stop | `docker compose down` |
| View logs (live) | `docker compose logs -f` |
| Restart | `docker compose restart` |

### 8.7 What's inside the image (technical)

The single image contains and runs together:

- the **API** (Node/Express), which also serves the **UI** (Angular build) on port `4300`;
- **MapServer 8**: the binary for *validation* (called directly by the API) and a CGI endpoint via **Apache** for *preview* (called by the API internally — not exposed outside);
- ready-made settings via environment variables (see **Chapter 6 — Configuration**). The Docker defaults are already correct (Linux paths), so **you don't need to change anything** to get started.

### 8.8 Optional: Mapfile Teacher (Gemini) in Docker

The Teacher is optional. To make it work inside Docker:

1. In `docker-compose.yml`, under `environment`, provide your own **Gemini API key** (uncomment it):

   ```yaml
       environment:
         GEMINI_API_KEY: "your-personal-key"
   ```

2. Put `MapServer.pdf` into the `workspace/` folder and, from the app's **Settings**, enable the Teacher pointing it to the path `/data/maps/MapServer.pdf`.
3. Run `docker compose up -d` to apply the changes.

### 8.9 Optional: Use your own MapServer with Docker

By default the image bundles its own MapServer 8 (used both for **validation** and for **WMS/WFS preview**). If you already have a MapServer running — for example MS4W on your Windows machine, a remote server, or another container — you can point the app to it instead, without rebuilding the image.

The app uses MapServer in two distinct ways, each controlled by its own environment variable:

| Purpose | Variable | What it controls |
|---|---|---|
| **Validation** | `MAPSERV_PATH` | Path to the `mapserv` binary called directly |
| **WMS/WFS preview** | `MAPSERV_URL` | HTTP URL of the MapServer CGI endpoint |

You can override either or both in `docker-compose.yml`.

---

#### Option A — External MapServer for preview only (most common)

If your MapServer already serves maps over HTTP (e.g. `http://192.168.1.50/cgi-bin/mapserv`), set `MAPSERV_URL`. The bundled binary is still used for validation.

```yaml
environment:
  TZ: "Europe/Athens"
  MAPSERV_URL: "http://192.168.1.50/cgi-bin/mapserv"   # ← your server
```

> **Note:** use the server's real IP address or hostname, **not** `localhost` — inside the container `localhost` refers to the container itself, not your host machine. On Windows/Mac you can use the special hostname `host.docker.internal` to reach your host:
> ```yaml
> MAPSERV_URL: "http://host.docker.internal/cgi-bin/mapserv"
> ```

---

#### Option B — External MapServer for both validation and preview

If you also want to replace the validation binary with your own, mount the `mapserv` binary into the container and set `MAPSERV_PATH`:

```yaml
volumes:
  - ./workspace:/data/maps
  - /path/to/your/mapserv:/usr/local/bin/mapserv-ext:ro   # mount your binary

environment:
  MAPSERV_PATH: "/usr/local/bin/mapserv-ext"
  MAPSERV_URL:  "http://192.168.1.50/cgi-bin/mapserv"
```

> **Important:** the container runs **Linux (Debian)**. The binary you mount must be compiled for Linux — a Windows `mapserv.exe` will not work inside the container.

---

#### Option C — MapServer in a separate Docker container

If your MapServer is also a Docker container, put both services in the same `docker-compose.yml` and let them share a network:

```yaml
services:
  mapfile-preview:
    build: .
    ports:
      - "4300:4300"
    volumes:
      - ./workspace:/data/maps
    environment:
      TZ: "Europe/Athens"
      MAPSERV_URL: "http://my-mapserver/cgi-bin/mapserv"   # service name = hostname
    networks:
      - gis-net

  my-mapserver:                        # your existing MapServer container
    image: camptocamp/mapserver:latest  # replace with your actual image
    volumes:
      - ./workspace:/data/maps         # share the same mapfiles
    networks:
      - gis-net

networks:
  gis-net:
```

Docker automatically resolves `my-mapserver` (the service name) to the right IP inside the shared network. Run `docker compose up -d --build` as usual.

---

**Quick reference — what to change depending on what you need:**

| I want… | What to set |
|---|---|
| Only preview → my MapServer | `MAPSERV_URL` in `docker-compose.yml` |
| Validation too → my binary (Linux) | `MAPSERV_PATH` + mount the binary |
| MapServer in another container | Shared network + `MAPSERV_URL` using the service name |

### 8.10 Troubleshooting

- **`http://localhost:4300` doesn't open** → make sure **Docker Desktop is running** ("Engine running"). Check the logs: `docker compose logs -f`.
- **I want to change the port** → keep the internal `4300` and change only the **left** number in `ports`, AND set `APP_ORIGIN` so the UI knows where the API is. Example in `docker-compose.yml`:

  ```yaml
      ports:
        - "8080:4300"
      environment:
        APP_ORIGIN: "http://localhost:8080"
  ```

  Then run `docker compose up -d` and open `http://localhost:8080`.
- **The preview is blank or shows an error** → usually the mapfile points to data that isn't inside `workspace/`, or to a Windows path. Fix the paths as in **8.5**.

## 9. Project Structure

```text
.
├─ client/             # UI (editor + map preview)
├─ server/             # API (workspace, validation, WMS/WFS/CGI proxy, Teacher)
├─ workspace/          # Your mapfiles & data (mounted into the container as /data/maps)
├─ docker/             # Docker support files (MapServer/Apache config, entrypoint, example.map)
├─ Dockerfile          # Single all-in-one image (UI + API + MapServer)
├─ docker-compose.yml  # One-command run (docker compose up -d --build)
├─ .dockerignore       # Files excluded from the image build
└─ zip_project.bat     # Helper script (if used in your environment)
```
