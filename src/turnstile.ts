// Turnstile VM interpreter
// Decrypts and executes Cloudflare Turnstile bytecode challenges

function xorDecrypt(dxB64: string, pKey: string): string {
  const dx = Buffer.from(dxB64, 'base64');
  const key = Buffer.from(pKey, 'utf-8');
  const result = Buffer.alloc(dx.length);
  for (let i = 0; i < dx.length; i++) {
    result[i] = dx[i]! ^ key[i % key.length]!;
  }
  return result.toString('utf-8');
}

const MOCK_WINDOW: Record<string, string> = {
  origin: 'https://chatgpt.com',
  pathname: '/',
  href: 'https://chatgpt.com/',
  hostname: 'chatgpt.com',
  protocol: 'https:',
};

const LOCALSTORAGE_KEYS = [
  'oai/apps/hasDismissedTeamsBanner',
  'oai/apps/hasSeenOnboarding/chat',
  'oai/apps/announcementsBanner/dismissed',
];

class TurnstileVM {
  private variables = new Map<string, unknown>();
  private stack: unknown[] = [];
  public result = '';

  private getValue(key: string): unknown {
    const parts = key.split('.');
    if (parts[0] === 'window') {
      if (parts[1] === 'localStorage') {
        return Object.fromEntries(LOCALSTORAGE_KEYS.map(k => [k, 'true']));
      }
      if (parts[1] === 'location' || (parts[1] === 'document' && parts[2] === 'location')) {
        return parts.length > 2 && parts[1] === 'location'
          ? MOCK_WINDOW[parts[2]!] ?? ''
          : MOCK_WINDOW;
      }
      if (parts[1] === 'navigator') {
        return {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          language: 'en-US',
          languages: ['en-US', 'en'],
          vendor: 'Google Inc.',
          platform: 'Win32',
          hardwareConcurrency: 8,
        };
      }
      if (parts[1] === 'screen') return { width: 1920, height: 1080 };
    }
    return this.variables.get(key) ?? '';
  }

  private callFunc(name: string, ...args: unknown[]): unknown {
    switch (name) {
      case 'performance.now': return Math.random() * 5000 + 100;
      case 'Math.random': return Math.random();
      case 'Date.now': return Date.now();
      case 'Object.keys':
        return typeof args[0] === 'object' && args[0] ? Object.keys(args[0]) : [];
      case 'Object.create': return {};
      case 'JSON.stringify':
        return args[0] !== undefined ? JSON.stringify(args[0]) : '';
      case 'JSON.parse':
        return typeof args[0] === 'string' ? JSON.parse(args[0]) : {};
      case 'btoa':
        return Buffer.from(String(args[0] ?? '')).toString('base64');
      case 'atob':
        return Buffer.from(String(args[0] ?? ''), 'base64').toString('utf-8');
      default: return null;
    }
  }

  execute(instructions: unknown[]): string {
    for (const inst of instructions) {
      if (!Array.isArray(inst) || inst.length === 0) continue;
      const [opcode, ...args] = inst;
      try {
        this.execOp(opcode as number, args);
      } catch {
        continue;
      }
    }
    return this.result;
  }

  private execOp(op: number, args: unknown[]): void {
    switch (op) {
      case 1: { // XOR_STR
        if (args.length >= 2) {
          const a = String(this.variables.get(args[0] as string) ?? args[0]);
          const b = String(this.variables.get(args[1] as string) ?? args[1]);
          let result = '';
          for (let i = 0; i < a.length; i++) {
            result += String.fromCharCode(a.charCodeAt(i) ^ b.charCodeAt(i % b.length));
          }
          this.variables.set(args[0] as string, result);
        }
        break;
      }
      case 2: // SET_VALUE
        if (args.length >= 2) this.variables.set(args[0] as string, args[1]);
        break;
      case 3: { // BTOA (final result)
        if (args.length >= 1) {
          const val = this.variables.get(args[0] as string) ?? args[0];
          const str = typeof val === 'string' ? val : JSON.stringify(val);
          this.result = Buffer.from(str).toString('base64');
        }
        break;
      }
      case 5: { // ADD/CONCAT
        if (args.length >= 2) {
          const a = this.variables.get(args[0] as string) ?? '';
          const b = this.variables.get(args[1] as string) ?? args[1];
          if (Array.isArray(a)) {
            a.push(b);
            this.variables.set(args[0] as string, a);
          } else {
            this.variables.set(args[0] as string, String(a) + String(b));
          }
        }
        break;
      }
      case 6: { // PROPERTY ACCESS
        if (args.length >= 3) {
          const obj = this.variables.get(args[1] as string) ?? this.getValue(args[1] as string);
          const key = args[2] as string;
          if (typeof obj === 'object' && obj !== null) {
            this.variables.set(args[0] as string, (obj as Record<string, unknown>)[key] ?? '');
          }
        }
        break;
      }
      case 7: { // CALL
        if (args.length >= 1) {
          const funcArgs = args.slice(1).map(a => this.variables.get(a as string) ?? a);
          const result = this.callFunc(args[0] as string, ...funcArgs);
          if (result !== null) this.stack.push(result);
        }
        break;
      }
      case 14: { // JSON_PARSE
        if (args.length >= 2) {
          const val = this.variables.get(args[1] as string) ?? args[1];
          if (typeof val === 'string') {
            try { this.variables.set(args[0] as string, JSON.parse(val)); } catch {}
          }
        }
        break;
      }
      case 15: { // JSON_STRINGIFY
        if (args.length >= 2) {
          const val = this.variables.get(args[1] as string) ?? args[1];
          this.variables.set(args[0] as string, JSON.stringify(val));
        }
        break;
      }
      case 17: { // CALL_AND_SET
        if (args.length >= 2) {
          const funcArgs = args.slice(2).map(a => this.variables.get(a as string) ?? a);
          const result = this.callFunc(args[1] as string, ...funcArgs);
          this.variables.set(args[0] as string, result);
        }
        break;
      }
      case 18: { // ATOB
        if (args.length >= 2) {
          const val = String(this.variables.get(args[1] as string) ?? args[1]);
          try {
            this.variables.set(args[0] as string, Buffer.from(val, 'base64').toString('utf-8'));
          } catch {
            this.variables.set(args[0] as string, '');
          }
        }
        break;
      }
      case 19: { // BTOA
        if (args.length >= 2) {
          const val = String(this.variables.get(args[1] as string) ?? args[1]);
          this.variables.set(args[0] as string, Buffer.from(val).toString('base64'));
        }
        break;
      }
    }
  }
}

export function solveTurnstile(dx: string, p: string): string {
  if (!dx || !p) return '';
  try {
    const decrypted = xorDecrypt(dx, p);
    const instructions = JSON.parse(decrypted);
    const vm = new TurnstileVM();
    return vm.execute(instructions);
  } catch {
    return '';
  }
}
