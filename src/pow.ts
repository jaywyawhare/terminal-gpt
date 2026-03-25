import crypto from 'node:crypto';
import type { Config } from './fingerprint.js';

function jsonCompact(val: unknown): string {
  return JSON.stringify(val).replace(/,/g, ',').replace(/:/g, ':');
  // JSON.stringify already produces compact output without spaces
}

function generateAnswer(seed: string, difficulty: string, config: Config): { answer: string; solved: boolean } {
  const diffLen = difficulty.length / 2;
  const seedBuf = Buffer.from(seed, 'utf-8');
  const target = Buffer.from(difficulty, 'hex');

  // Build static config parts: [0..2], [4..8], [10..17]
  // slots [3] and [9] are dynamic
  const prefix = JSON.stringify(config.slice(0, 3)) .slice(0, -1) + ',';  // remove ] add ,
  const mid = ',' + JSON.stringify(config.slice(4, 9)).slice(1, -1) + ','; // strip [] add ,
  const suffix = ',' + JSON.stringify(config.slice(10)).slice(1);           // strip [

  const prefixBuf = Buffer.from(prefix);
  const midBuf = Buffer.from(mid);
  const suffixBuf = Buffer.from(suffix);

  for (let i = 0; i < 500000; i++) {
    const iBuf = Buffer.from(String(i));
    const jBuf = Buffer.from(String(i >> 1));
    const final = Buffer.concat([prefixBuf, iBuf, midBuf, jBuf, suffixBuf]);
    const encoded = final.toString('base64');
    const hash = crypto.createHash('sha3-512').update(seedBuf).update(encoded).digest();
    if (hash.subarray(0, diffLen).compare(target.subarray(0, diffLen)) <= 0) {
      return { answer: encoded, solved: true };
    }
  }

  // Fallback
  const fallback = 'wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D' + Buffer.from(`"${seed}"`).toString('base64');
  return { answer: fallback, solved: false };
}

export function solveProofOfWork(seed: string, difficulty: string, config: Config): string {
  const { answer } = generateAnswer(seed, difficulty, [...config]);
  return 'gAAAAAB' + answer;
}

export function getRequirementsToken(config: Config): string {
  const seed = String(Math.random());
  const difficulty = '0fffff';
  const { answer } = generateAnswer(seed, difficulty, [...config]);
  return 'gAAAAAC' + answer;
}
