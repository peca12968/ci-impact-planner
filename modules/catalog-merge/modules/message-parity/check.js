import {readFileSync} from 'node:fs';
import {compareCatalogs} from './parity.js';

function readCatalog(path) {
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(readFileSync(path));
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw new Error('usage: node check.js SOURCE_LOCALE SOURCE.json TARGET_LOCALE TARGET.json');
  const [from, source, to, target] = args;
  const result = compareCatalogs(readCatalog(source), from, readCatalog(target), to);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.findings.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
