// server/src/lib/spawnMapserv.js  (patched: allow temp mapfiles under WORKSPACE_DIR)
// Fixes: msCGILoadMap(): CGI variable "map" fails to validate.
// Reason: MapServer validates the CGI "map" parameter using MS_MAP_PATTERN / MS_MAP_NO_PATH (often set in mapserver.conf).
// This patch sets a safe, narrow MS_MAP_PATTERN allowing only *.map under your workspaceDir (e.g. C:\data\maps\temp_*.map).

const { spawn } = require('child_process');
const { mapservPath, mapserverConfPath, workspaceDir } = require('../config');

function escapeForPosixRegex(s) {
  // Escape regex metacharacters for a literal match (POSIX ERE style is fine with these escapes)
  // Also turns "\" into "\\" so MapServer's regex engine matches Windows backslashes.
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = function spawnMapserv(queryString, { method = 'GET' } = {}) {
  const wsEsc = escapeForPosixRegex(workspaceDir);

  // Allow only mapfiles under workspaceDir:
  // Example result: ^C:\\data\\maps\\.*\.map$
  const safeMapPattern = `^${wsEsc}\\\\.*\\.map$`;

  // Populate CGI variables so MapServer can build OnlineResource when metadata is missing.
  let u;
  try { u = new URL(mapservUrl); } catch { u = null; }

  const env = {
    ...process.env,
    REQUEST_METHOD: method,
    QUERY_STRING: queryString,

    // Send MapServer errors to stderr so we can parse them:
    MS_ERRORFILE: 'stderr',

    // Ensure MapServer reads the same config you use in IIS/Apache:
    MAPSERVER_CONFIG_FILE: mapserverConfPath,

    // ✅ IMPORTANT: let absolute paths through (override if mapserver.conf sets MS_MAP_NO_PATH=1)
    MS_MAP_NO_PATH: '0',

    // ✅ IMPORTANT: allow only workspaceDir mapfiles for this spawned mapserv process
    MS_MAP_PATTERN: safeMapPattern
  };

  console.log(`🚀 [spawnMapserv] Using mapserv at: ${mapservPath}`);
  console.log(`🚀 [spawnMapserv] MAPSERVER_CONFIG_FILE=${env.MAPSERVER_CONFIG_FILE}`);
  console.log(`🚀 [spawnMapserv] MS_MAP_PATTERN=${env.MS_MAP_PATTERN}`);
  console.log(`🚀 [spawnMapserv] QUERY_STRING=${queryString}`);

  const child = spawn(mapservPath, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();

  return child;
};
