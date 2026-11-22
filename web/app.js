import { subjectBuckets, compilePolicy, compareAudience } from "./rollout.js";

const el = (id) => document.getElementById(id);
const labels = {
  entered: "新加入",
  exited: "退出",
  switched: "版本切換",
  unchanged: "維持原狀",
};
const version = (value) => (value === null ? "未開放" : value + " 版");
const size = 1000;
let audience = [];
let result;
let tiles = [];

function policy(rate, weight) {
  return compilePolicy({
    rollout: rate * 100,
    variants: [
      { name: "A", weight: weight * 100 },
      { name: "B", weight: (100 - weight) * 100 },
    ],
  });
}

function lookup() {
  if (!result) return;
  const n = el("account").valueAsNumber;
  if (!Number.isInteger(n) || n < 1 || n > size) {
    el("assignment").textContent = "請輸入 1 至 1000 的整數。";
    return;
  }
  const row = result.rows[n - 1];
  el("assignment").textContent =
    `${row.id}　${version(row.before)} → ${version(row.after)}（${labels[row.change]}）`;
}

function render() {
  for (const name of ["current", "proposed", "weight"])
    el(name + "-value").textContent = el(name).value + "%";
  if (!audience.length) return;
  result = compareAudience(
    audience,
    policy(el("current").valueAsNumber, 50),
    policy(el("proposed").valueAsNumber, el("weight").valueAsNumber),
  );
  for (const [kind, value] of Object.entries(result.counts))
    el(kind).textContent = String(value);
  result.rows.forEach((row, i) => {
    tiles[i].className = row.change;
  });
  const changes = result.rows.filter((row) => row.change !== "unchanged");
  el("list-note").textContent = changes.length
    ? `共 ${changes.length} 個帳號有變動，顯示前 ${Math.min(20, changes.length)} 個。`
    : "這次設定沒有改變任何示範帳號的版本。";
  el("changes").replaceChildren(
    ...changes.slice(0, 20).map((row) => {
      const tr = document.createElement("tr");
      for (const text of [
        row.id,
        version(row.before),
        version(row.after),
        labels[row.change],
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
  lookup();
}

for (const id of ["current", "proposed", "weight"])
  el(id).addEventListener("input", render);
el("account").addEventListener("input", lookup);
try {
  audience = await Promise.all(
    Array.from({ length: size }, async (_, index) => {
      const id = "demo-" + String(index + 1).padStart(4, "0");
      return { id, buckets: await subjectBuckets("checkout-layout", id) };
    }),
  );
  tiles = audience.map(() => document.createElement("i"));
  el("cohort").replaceChildren(...tiles);
  render();
} catch {
  el("assignment").textContent = "";
  el("error").textContent =
    "無法計算分組。請以 localhost 或 HTTPS 在支援 Web Crypto 的現代瀏覽器開啟。";
}
