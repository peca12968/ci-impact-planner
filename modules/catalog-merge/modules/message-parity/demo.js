import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IntlMessageFormat} from 'intl-messageformat';
import {compareCatalogs} from './parity.js';

const catalog = name => JSON.parse(readFileSync(new URL(`./examples/${name}.json`, import.meta.url), 'utf8'));
const source = catalog('en');
const draft = catalog('zh-TW.draft');
const fixed = catalog('zh-TW');
const issues = target => compareCatalogs(source, 'en', target, 'zh-TW').findings;
assert.deepEqual(issues(draft).map(issue => [issue.id, issue.code]), [
  ['cart', 'missing-branch'], ['delivery', 'missing-branch'], ['refund', 'argument-format']
]);
assert.deepEqual(issues(fixed), []);

const money = new Intl.NumberFormat('zh-TW', {style: 'currency', currency: 'TWD'}).format(1234.5);
const scenarios = [
  ['refund', {amount: 1234.5}, `退款金額為 ${money}。`],
  ['delivery', {mode: 'pickup', store: '台中站'}, '請至台中站取貨。'],
  ['cart', {count: 0}, '購物車是空的。'],
  ['delivery', {mode: 'courier', address: '和平路'}, '寄至和平路。'],
  ['cart', {count: 3}, '購物車有 3 件商品。'],
  ['order', {id: 'A17', name: '小林'}, '小林的訂單編號是 A17。']
];
const rendered = scenarios.map(([id, values, expected]) => {
  const format = messages => new IntlMessageFormat(messages[id], 'zh-TW').format(values);
  const before = format(draft);
  const after = format(fixed);
  assert.equal(after, expected);
  return {id, values, before, after};
});
assert.equal(rendered.filter(row => row.before !== row.after).length, 3);
console.log(JSON.stringify({draftFindings: issues(draft), rendered}, null, 2));
