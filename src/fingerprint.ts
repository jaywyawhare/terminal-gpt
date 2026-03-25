import crypto from 'node:crypto';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

const NAVIGATOR_KEYS = [
  'vendor-Google Inc.',
  'vendor-',
  'vendorSub-',
  'productSub-20030107',
  'productSub-20100101',
];

const DOCUMENT_KEYS = [
  '_reactListeningo743lnnpvdg',
  '_reactListeningzw72ump40ol',
  '_reactListeningtm3ymhhlwsk',
  '__reactEvents$abcdef123456',
];

const WINDOW_KEYS = [
  'fetch',
  'localStorage',
  'sessionStorage',
  'crypto',
  'performance',
  'navigator',
  'location',
];

const SCREEN_SIZES: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [1366, 768],
  [1536, 864],
  [1440, 900],
  [3840, 2160],
];

const CPU_CORES = [8, 12, 16, 24, 32];

const TIMEZONES = [
  'Eastern Standard Time',
  'Central Standard Time',
  'Mountain Standard Time',
  'Pacific Standard Time',
];

const OFFSETS = ['-0500', '-0600', '-0700', '-0800'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateTimeString(): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const t = new Date();
  const tz = pick(TIMEZONES);
  const offset = pick(OFFSETS);
  return `${days[t.getUTCDay()]} ${months[t.getUTCMonth()]} ${String(t.getUTCDate()).padStart(2, '0')} ${t.getUTCFullYear()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')} GMT${offset} (${tz})`;
}

export type Config = (string | number)[];

export function generateConfig(): { config: Config; ua: string } {
  const screen = pick(SCREEN_SIZES);
  const perfCounter = Math.round(Math.random() * 450 + 50 * 100) / 100;
  const cores = pick(CPU_CORES);
  const ua = pick(USER_AGENTS);

  const config: Config = [
    screen[0] + screen[1],           // [0]
    generateTimeString(),             // [1]
    4294705152,                       // [2]
    0,                                // [3] dynamic
    ua,                               // [4]
    '',                               // [5]
    '',                               // [6]
    'en-US',                          // [7]
    'en-US,en',                       // [8]
    0,                                // [9] dynamic
    pick(NAVIGATOR_KEYS),             // [10]
    pick(DOCUMENT_KEYS),              // [11]
    pick(WINDOW_KEYS),                // [12]
    perfCounter,                      // [13]
    crypto.randomUUID(),              // [14]
    '',                               // [15]
    cores,                            // [16]
    Math.round(Date.now() - perfCounter * 1000), // [17]
  ];

  return { config, ua };
}

export function generateDeviceId(): string {
  return crypto.randomUUID();
}

export function getHeaders(ua: string, deviceId: string, oaiVersion?: string): Record<string, string> {
  const h: Record<string, string> = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'oai-device-id': deviceId,
    'oai-language': 'en-US',
    'origin': 'https://chatgpt.com',
    'referer': 'https://chatgpt.com/',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': ua,
  };
  if (oaiVersion) {
    h['oai-client-version'] = oaiVersion;
  }
  return h;
}
