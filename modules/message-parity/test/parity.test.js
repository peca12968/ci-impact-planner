import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {IntlMessageFormat} from 'intl-messageformat';
import {compareCatalogs} from '../parity.js';

const check = (left, right, to = 'zh-TW') => compareCatalogs({m: left}, 'en', {m: right}, to).findings;
const run = (...args) => spawnSync(process.execPath, args, {
  cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 15000
});

test('detects a branch-local placeholder swap even when global names match', () => {
  const left = '{kind, select, pickup {{store}} other {{address}}}';
  const right = '{kind, select, pickup {{address}} other {{store}}}';
  const findings = check(left, right);
  assert.equal(findings.length, 4);
  assert.deepEqual(findings.filter(f => !f.actual.length).map(f => [f.branch[0].label, f.argument]),
    [['other', 'address'], ['pickup', 'store']]);
  assert.throws(() => new IntlMessageFormat(right, 'zh-TW').format({kind: 'pickup', store: '台北'}));
});

test('retains nested exact branches and honors target-specific grammatical categories', () => {
  const left = '{site, select, web {{n, plural, =0 {Empty} one {One} other {# units for {user}}}} other {Closed}}';
  const right = '{site, select, other {關閉} web {{n, plural, other {{user} 有 # 件}}}}';
  assert.deepEqual(check(left, right), [{id: 'm', code: 'missing-branch',
    branch: [{argument: 'site', label: 'web'}, {argument: 'n', label: '=0'}]}]);
  const english = '{n, plural, one {# item} other {# items}}';
  const russian = '{n, plural, one {# товар} few {# товара} many {# товаров} other {# товара}}';
  assert.deepEqual(check(english, russian, 'ru'), []);
  assert.throws(() => check(english, russian, 'zh-TW'), /unavailable/);
});

test('target-only grammatical arms inherit the source other contract', () => {
  const left = '{n, plural, other {# for {name}}}';
  const right = '{n, plural, few {#} other {# {name}}}';
  const [issue] = check(left, right, 'pl');
  assert.deepEqual(issue, {id: 'm', branch: [{argument: 'n', label: 'few'}],
    code: 'argument-format', argument: 'name', expected: ['argument'], actual: []});
});

test('preserves selector kinds, offsets and unquoted number substitutions', () => {
  const base = '{n, plural, offset:1 other {#}}';
  assert.deepEqual(check(base, "{n, plural, other {'#'}}").map(i => i.code), ['plural-offset', 'plural-number']);
  assert.deepEqual(check(base, '{n, selectordinal, other {#}}').map(i => i.code), ['selector-kind']);
  assert.deepEqual(check("'{x}' {a} {b}", "{b} {a} '{x}'"), []);
});

test('number formats carry currency and measurement options across translations', () => {
  const left = '{amt, number, ::currency/TWD}';
  for (const right of ['{amt}', '{amt, number, ::currency/USD}', '{amt, number, percent}']) {
    assert.equal(check(left, right)[0].code, 'argument-format');
  }
  assert.deepEqual(check('{d, date, short} {t, time, short}', '{t, time, long} {d, date, medium}'), []);
});

test('input validation avoids passing malformed or unsupported catalogs', () => {
  for (const invalid of ['{', '{n, select, x {yes}}', '<b>{x}</b>',
    '{n, select, other {a}} {n, select, other {b}}']) {
    assert.throws(() => check('{x}', invalid), /zh-TW message "m"/);
  }
  assert.throws(() => compareCatalogs([], 'en', {}, 'fr'), /JSON object/);
  assert.throws(() => check('text', 'text', 'zz-ZZ'), /unsupported locale/);
  assert.throws(() => compareCatalogs({bad: 3}, 'en', {}, 'zh-TW'), /expected a message string/);
});

test('matches message IDs and placeholders as opaque names', () => {
  const left = JSON.parse('{"__proto__":"{constructor}","removed":"a"}');
  const right = JSON.parse('{"__proto__":"{constructor}","added":"b"}');
  assert.deepEqual(compareCatalogs(left, 'en', right, 'zh-TW').findings, [
    {id: 'added', code: 'extra-message'}, {id: 'removed', code: 'missing-message'}
  ]);
});

test('CLI exit codes distinguish parity, translation findings, and invalid input', () => {
  const cli = file => run('check.js', 'en', 'examples/en.json', 'zh-TW', file);
  const good = cli('examples/zh-TW.json');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).checked, 4);
  const draft = cli('examples/zh-TW.draft.json');
  assert.equal(draft.status, 1);
  assert.equal(JSON.parse(draft.stdout).findings.length, 3);
  const bad = cli('missing.json');
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /missing.json/);
});

test('the executable demo compares six real formatted messages', () => {
  const result = run('demo.js');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).rendered.length, 6);
});

test('64 nested catalog variants agree with execution on all six business paths', () => {
  const modes = ['pickup', 'other'];
  const phases = ['ready', 'late', 'other'];
  function message(mask) {
    const groups = modes.map((mode, i) => {
      const arms = phases.map((phase, j) => {
        const leaf = i * phases.length + j;
        const field = (mask & (1 << leaf)) ? (leaf + 1) % 6 : leaf;
        return `${phase} {{detail${field}}}`;
      });
      return `${mode} {{phase, select, ${arms.join(' ')}}}`;
    });
    return `{mode, select, ${groups.join(' ')}}`;
  }
  const source = message(0);
  for (let mask = 0; mask < 64; mask++) {
    const target = message(mask);
    const formatter = new IntlMessageFormat(target, 'zh-TW');
    const failed = new Set();
    for (const [i, mode] of modes.entries()) {
      for (const [j, phase] of phases.entries()) {
        const values = {mode, phase, [`detail${i * phases.length + j}`]: '測試值'};
        try {
          formatter.format(values);
        } catch {
          failed.add(`${mode}/${phase}`);
        }
      }
    }
    const diagnosed = new Set(check(source, target).map(issue => issue.branch.map(b => b.label).join('/')));
    assert.deepEqual(diagnosed, failed, `variant ${mask}`);
  }
});
