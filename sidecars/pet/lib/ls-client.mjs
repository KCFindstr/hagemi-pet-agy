// Talks to Antigravity's local language server. Sidecars get its address and CSRF token from
// the host through the environment; outside a sidecar (npm run dev) they are discovered from the
// running process. The token stays in memory and is never logged, stored or sent to a page.
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SERVICE = '/exa.language_server_pb.LanguageServerService/';

function post(host, port, csrf, method, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({
      hostname: host, port, method: 'POST', path: SERVICE + method,
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': csrf, 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const error = new Error(`${method} returned ${res.statusCode}`);
          error.status = res.statusCode;
          reject(error);
          return;
        }
        try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error(`${method} returned malformed JSON`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${method} timed out`)));
    req.end(data);
  });
}

async function discover() {
  const platform = process.platform;
  let rows = [];
  if (platform === 'win32') {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='language_server.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 1 << 20 });
    rows = stdout.trim() ? [JSON.parse(stdout)].flat().map(r => ({ pid: r.ProcessId, command: r.CommandLine || '' })) : [];
  } else {
    const { stdout } = await exec('ps', ['-ww', '-axo', 'pid=,args='], { timeout: 8000, maxBuffer: 1 << 22 });
    rows = stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(.*)$/)).filter(Boolean).map(m => ({ pid: Number(m[1]), command: m[2] })).filter(r => /language_server/.test(r.command));
  }
  const row = rows.find(r => /--standalone\b/.test(r.command));
  if (!row) throw new Error('Antigravity is not running');
  const csrf = row.command.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
  if (!csrf) throw new Error('Language server exposes no CSRF token');
  const listing = platform === 'win32'
    ? (await exec('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 5000, maxBuffer: 1 << 22 })).stdout
    : (await exec('lsof', ['-nP', '-a', '-p', String(row.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { timeout: 5000 })).stdout;
  const ports = platform === 'win32'
    ? [...listing.matchAll(/TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+\S+\s+(\d+)/g)].filter(m => Number(m[2]) === row.pid).map(m => Number(m[1]))
    : [...listing.matchAll(/:(\d+)\s*$/gm)].map(m => Number(m[1]));
  for (const port of new Set(ports)) {
    try {
      await post('127.0.0.1', port, csrf, 'GetStatus', {}, 2500);
      return { host: '127.0.0.1', port, csrf };
    } catch { /* The TLS and extension ports reject this; keep looking. */ }
  }
  throw new Error('Language server port not found');
}

export class LanguageServer {
  constructor({ env = process.env, discoverFn = discover, transport = post } = {}) {
    this.transport = transport;
    this.discoverFn = discoverFn;
    this.endpoint = null;
    const address = env.ANTIGRAVITY_LS_ADDRESS, csrf = env.ANTIGRAVITY_CSRF_TOKEN;
    if (address && csrf) {
      const index = address.lastIndexOf(':');
      this.endpoint = { host: address.slice(0, index) || '127.0.0.1', port: Number(address.slice(index + 1)), csrf };
      this.fromHost = true;
    }
  }

  async call(method, body = {}, timeoutMs = 12000) {
    if (!this.endpoint) this.endpoint = await this.discoverFn();
    try {
      return await this.transport(this.endpoint.host, this.endpoint.port, this.endpoint.csrf, method, body, timeoutMs);
    } catch (error) {
      // A language server restart invalidates both the port and the token. The host restarts
      // sidecars when that happens; in dev mode, look again next time.
      if (!this.fromHost && (error.status === 401 || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET')) this.endpoint = null;
      throw error;
    }
  }
}
