import fs from 'fs';
import path from 'path';
import { LaunchRecord } from './types';

/**
 * Append-only JSONL writer. We open the file synchronously once, then write
 * with `appendFile` (async) so the hot path doesn't block on disk I/O.
 *
 * BigInt values are stringified — JSON.stringify can't handle them natively.
 */
export class JsonlLogger {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Touch the file so it exists even before the first launch arrives.
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '');
  }

  write(record: LaunchRecord): void {
    const line = JSON.stringify(record, bigintReplacer) + '\n';
    fs.appendFile(this.filePath, line, (err) => {
      if (err) {
        // Log to stderr but don't throw — losing one line is better than crashing the watcher.
        process.stderr.write(`[logger] append failed: ${err.message}\n`);
      }
    });
  }

  path(): string {
    return this.filePath;
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
