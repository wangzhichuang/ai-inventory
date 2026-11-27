"use strict";
const $ = (id) => document.getElementById(id);
const categories = {
  memory: ["记忆", "偏好、规则与会话摘要"],
  skill: ["Skill", "可复用的工作方法"],
  mcp: ["MCP", "配置和插件中的服务"],
};
const size = 25;
let items = [],
  kind = "",
  page = 0,
  loading = false,
  isDemo = false;
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const appsOf = (row) => [...new Set(row.sources.map((s) => s.app))];
const date = (value) =>
  value ? new Date(value * 1000).toLocaleDateString("zh-CN") : "示例";
const purposes = [
  [/calendar/i, "查询日历与日程"],
  [/github/i, "访问 GitHub 仓库与协作工具"],
  [/figma/i, "读取或编辑设计文件"],
  [/devtools|browser/i, "浏览器调试与页面检查"],
  [/postgres|mysql|metabase/i, "查询数据库或分析数据"],
  [/codegraph/i, "查询代码结构与调用关系"],
  [/repl/i, "运行交互式工具"],
  [/appstore|play-console/i, "查询应用商店数据"],
  [/analytics/i, "查询分析数据"],
];
function description(row) {
  if (row.description || row.kind !== "mcp") return row.description;
  const match = purposes.find(([pattern]) => pattern.test(row.title));
  return match ? match[1] + "（按名称推测）" : "查看配置来源与声明状态";
}
function setGroups() {
  const old = $("group").value;
  const groups = [
    ...new Set(
      items.filter((x) => !kind || x.kind === kind).flatMap((x) => x.groups)
    ),
  ].sort();
  $("group").replaceChildren(
    new Option("全部类型", ""),
    ...groups.map((g) => new Option(g, g))
  );
  if (groups.includes(old)) $("group").value = old;
}
function cards() {
  const nodes = Object.entries(categories).map(([key, [label, hint]]) => {
    const btn = el("button", undefined, "card " + key);
    btn.setAttribute("aria-pressed", String(key === kind));
    btn.append(
      el("span", label),
      el("small", hint),
      el("b", items.filter((r) => r.kind === key).length)
    );
    btn.onclick = () => {
      kind = kind === key ? "" : key;
      page = 0;
      setGroups();
      render();
    };
    return btn;
  });
  document.querySelector(".cards").replaceChildren(...nodes);
}
function details(row) {
  const dialog = $("detail"),
    body = $("body");
  $("title").textContent = row.title;
  body.replaceChildren(
    el("p", description(row)),
    el("p", row.groups.join(" / ") + " · 文件更新 " + date(row.updated)),
    el("h3", "来源位置")
  );
  const list = el("ul");
  for (const s of row.sources) {
    const li = el("li", [s.app, s.scope, s.status].filter(Boolean).join(" · "));
    li.append(el("br"), el("code", s.path));
    list.append(li);
  }
  body.append(list);
  if (row.kind !== "mcp" && !isDemo) {
    const fold = el("details"),
      pre = el("pre");
    fold.append(el("summary", "阅读原文"), pre);
    let loaded = false;
    fold.ontoggle = async () => {
      if (!fold.open || loaded) return;
      pre.textContent = "正在读取…";
      try {
        const resp = await fetch("/api/document/" + row.id);
        if (!resp.ok) throw Error();
        pre.textContent = await resp.text();
        loaded = true;
      } catch {
        pre.textContent = "读取失败。文件可能已移动，请刷新目录。";
      }
    };
    body.append(fold);
  }
  dialog.showModal();
}
function render() {
  cards();
  const app = $("app").value,
    group = $("group").value;
  const terms = $("search")
    .value.toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const result = items.filter((row) => {
    const apps = appsOf(row);
    if ((kind && row.kind !== kind) || (group && !row.groups.includes(group)))
      return false;
    if (app === "shared" ? apps.length < 2 : app && !apps.includes(app))
      return false;
    if (!terms.length) return true;
    const words = [
      row.title,
      description(row),
      categories[row.kind][0],
      ...row.groups,
      ...row.sources.flatMap((s) => [s.app, s.path, s.scope, s.status]),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((t) => words.includes(t));
  });
  result.sort(
    (a, b) =>
      ($("sort").value === "recent" ? b.updated - a.updated : 0) ||
      a.title.localeCompare(b.title, "zh-CN")
  );
  page = Math.min(page, Math.max(0, Math.ceil(result.length / size) - 1));
  const offset = page * size,
    slice = result.slice(offset, offset + size);
  const rows = slice.map((row) => {
    const tr = el("tr"),
      name = el("td"),
      btn = el("button", row.title, "item"),
      apps = el("td");
    btn.onclick = () => details(row);
    name.append(btn, el("div", description(row), "desc"));
    for (const app of appsOf(row))
      apps.append(el("span", app, "tag " + app.toLowerCase()));
    tr.append(name, apps, el("td", row.groups[0]), el("td", date(row.updated)));
    return tr;
  });
  if (!rows.length) {
    const tr = el("tr"),
      td = el(
        "td",
        items.length
          ? "没有匹配项。可以换一个关键词或清除筛选。"
          : "当前目录没有可展示的条目。"
      );
    td.colSpan = 4;
    tr.append(td);
    rows.push(tr);
  }
  $("rows").replaceChildren(...rows);
  $("total").textContent = result.length + " 项";
  $("range").textContent = slice.length
    ? "显示 " + (offset + 1) + "–" + (offset + slice.length) + " 项"
    : "显示 0 项";
  $("prev").disabled = page === 0;
  $("next").disabled = offset + size >= result.length;
  $("filters").replaceChildren();
  if (kind || app || group || terms.length) {
    const clear = el(
      "button",
      (kind ? categories[kind][0] + " · " : "") + "清除筛选"
    );
    clear.onclick = () => {
      kind = "";
      page = 0;
      $("app").value = "";
      $("group").value = "";
      $("search").value = "";
      setGroups();
      render();
    };
    $("filters").append(clear);
  }
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("reload").disabled = true;
  try {
    const resp = await fetch("/api/inventory");
    if (!resp.ok) throw Error();
    const data = await resp.json();
    items = data.items;
    isDemo = Boolean(data.demo);
    $("subtitle").textContent = isDemo
      ? "虚构示例目录"
      : "Codex 与 Claude 的本机目录";
    $("stamp").textContent =
      "上次扫描 " + new Date(data.scanned).toLocaleTimeString("zh-CN");
    $("alert").hidden = !data.warnings.length;
    $("alert").textContent = data.warnings.length
      ? "部分来源读取失败：" + data.warnings.join("、")
      : "";
    setGroups();
    render();
  } catch {
    $("stamp").textContent = "扫描失败";
    $("alert").hidden = false;
    $("alert").textContent = "无法刷新本机目录，请检查本机服务后重试。";
  } finally {
    loading = false;
    $("reload").disabled = false;
  }
}
$("reload").onclick = refresh;
$("search").oninput = () => {
  page = 0;
  render();
};
for (const id of ["app", "group", "sort"])
  $(id).onchange = () => {
    page = 0;
    render();
  };
$("prev").onclick = () => {
  page--;
  render();
};
$("next").onclick = () => {
  page++;
  render();
};
$("close").onclick = () => $("detail").close();
$("detail").onclick = (e) => {
  if (e.target === $("detail")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
setInterval(() => {
  if (!document.hidden && !$("detail").open) refresh();
}, 60000);
refresh();
