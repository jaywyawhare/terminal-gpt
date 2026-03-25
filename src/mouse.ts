import { Transform, type TransformCallback } from 'node:stream';

type ScrollCallback = (direction: 'up' | 'down') => void;

const MOUSE_RE = /\x1b\[<(\d+);\d+;\d+[Mm]/g;

let scrollCb: ScrollCallback | null = null;

class MouseFilterStream extends Transform {
  isTTY = true;
  isRaw = false;

  constructor() {
    super();
    const real = process.stdin as unknown as Record<string, unknown>;
    this.isRaw = (real.isRaw as boolean) ?? false;
  }

  setRawMode(mode: boolean): this {
    const real = process.stdin as unknown as { setRawMode?: (m: boolean) => void; isRaw?: boolean };
    if (real.setRawMode) {
      real.setRawMode(mode);
    }
    this.isRaw = mode;
    return this;
  }

  ref(): this {
    (process.stdin as any).ref?.();
    return this;
  }

  unref(): this {
    (process.stdin as any).unref?.();
    return this;
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
    let str = chunk.toString('utf-8');

    MOUSE_RE.lastIndex = 0;
    let match;
    while ((match = MOUSE_RE.exec(str)) !== null) {
      const btn = parseInt(match[1]!, 10);
      if (btn === 64 && scrollCb) scrollCb('up');
      else if (btn === 65 && scrollCb) scrollCb('down');
    }

    const cleaned = str.replace(MOUSE_RE, '');
    if (cleaned.length > 0) {
      this.push(Buffer.from(cleaned, 'utf-8'));
    }
    callback();
  }
}

let filterStream: MouseFilterStream | null = null;

export function setScrollCallback(cb: ScrollCallback | null) {
  scrollCb = cb;
}

export function createFilteredStdin(): MouseFilterStream {
  process.stdout.write('\x1b[?1000h');
  process.stdout.write('\x1b[?1006h');

  filterStream = new MouseFilterStream();
  process.stdin.pipe(filterStream);

  return filterStream;
}

export function disableMouse() {
  process.stdout.write('\x1b[?1006l');
  process.stdout.write('\x1b[?1000l');
  if (filterStream) {
    process.stdin.unpipe(filterStream);
    filterStream.destroy();
    filterStream = null;
  }
}
