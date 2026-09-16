/**
 * Kill whatever is listening on a port.
 *
 * The database emulator runs as a child Java process, and when a test run is
 * interrupted the CLI can exit without taking it down — leaving the next run to
 * fail with "port taken". This clears that, and is a no-op when the port is
 * already free.
 *
 *     node scripts/free-port.mjs 9000 9099
 */

import { execFileSync } from 'node:child_process';

const ports = process.argv.slice(2).map(Number).filter(Boolean);
if (ports.length === 0) {
  console.error('usage: node scripts/free-port.mjs <port> [port...]');
  process.exit(1);
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return '';
  }
}

/** PIDs holding a LISTEN socket on `port`, never including this process. */
function listenersOn(port) {
  const pids = new Set();

  if (process.platform === 'win32') {
    for (const line of run('netstat', ['-ano', '-p', 'TCP']).split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
      if (!parts[1]?.endsWith(`:${port}`)) continue;
      pids.add(Number(parts[4]));
    }
  } else {
    for (const pid of run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).split(
      /\s+/,
    )) {
      if (pid) pids.add(Number(pid));
    }
  }

  pids.delete(process.pid);
  return [...pids].filter(Number.isInteger);
}

for (const port of ports) {
  for (const pid of listenersOn(port)) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`freed port ${port} (pid ${pid})`);
    } catch (err) {
      console.warn(`could not stop pid ${pid} on port ${port}: ${err.message}`);
    }
  }
}
