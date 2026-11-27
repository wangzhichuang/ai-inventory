"use strict";
const $ = (id) => document.getElementById(id);
function el(tag, text, cls) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
}
const sections = {
  skill: ["工作方法", "Skill", "找到能帮你完成具体任务的工作方法。", "◇"],
  memory: [
    "记忆地图",
    "记忆",
    "选择一个主题，查看 AI 在这件事上记住了什么。",
    "⌘",
  ],
  mcp: [
    "工具连接",
    "MCP",
    "查看 AI 能连接哪些服务，以及每个服务能做什么。",
    "⇄",
  ],
};
const topics = [
  [
    "协作偏好",
    "习惯、约定与个人偏好",
    /偏好|约定|preference|协作规则|署名|风格/gi,
  ],
  [
    "开发与调试",
    "代码、故障与验证经验",
    /调试|模拟器|排查|故障|修复|代码|验证|simulator|debug|bug|regression|fix|checkout/gi,
  ],
  [
    "需求与交付",
    "从需求评审到版本发布",
    /需求|提测|周报|发布|发版|交付|分支|release|branch|handoff|requirement|weekly/gi,
  ],
  [
    "产品与业务",
    "产品行为、运营与业务决定",
    /产品|业务|返现|商家|测券|营收|优惠|运营|弹窗|merchant|coupon|cashback|product/gi,
  ],
  [
    "工具与环境",
    "安装、配置与工作区",
    /环境|配置|安装|工具|工作区|账号|部署|plugin|install|setup|worktree|runtime|同步|ssh/gi,
  ],
  [
    "知识与资料",
    "文档、记忆与资料整理",
    /索引|记忆|手册|文档|知识库|memory|document|notes|knowledge/gi,
  ],
  [
    "生活与创作",
    "个人生活和创作记录",
    /生活|家人|妻子|旅行|宠物|视频|照片|摄影|画画|音乐|个人项目|创作|小红书|游戏|食谱|旅游|教育|孩子|练习/gi,
  ],
  ["其他主题", "暂未匹配以上主题的记录", null],
];
function topicOf(row) {
  if (row.groups.includes("记忆索引")) return "知识与资料";
  if (row.groups.includes("协作规则")) return "协作偏好";
  const stem = row.sources[0]?.path.split("/").pop() || "";
  let best = "其他主题",
    top = 0;
  for (const [topic, , pattern] of topics) {
    if (!pattern) continue;
    const score =
      ((row.displayName || row.title).match(pattern)?.length || 0) * 4 +
      (stem.match(pattern)?.length || 0) * 2 +
      (row.description.match(pattern)?.length || 0);
    if (score > top) {
      best = topic;
      top = score;
    }
  }
  return best;
}
const appsOf = (row) => [...new Set(row.sources.map((s) => s.app))];
const date = (n) =>
  n ? new Date(n * 1000).toLocaleDateString("zh-CN") : "示例";
const pageSize = 12;
let rows = [],
  kind = Object.hasOwn(sections, location.hash.slice(1))
    ? location.hash.slice(1)
    : "skill",
  topic = "",
  page = 0,
  loading = false,
  isDemo = false;
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
function normalize(row) {
  row.topic = row.kind === "memory" ? topicOf(row) : "";
  row.name = row.displayName || row.title;
  if (
    row.kind === "memory" &&
    !/[\u4e00-\u9fff]/.test(row.name) &&
    /[\u4e00-\u9fff]/.test(row.description)
  ) {
    row.name = row.description.split(/[。；：\n]/)[0].slice(0, 48) || row.title;
  }
  row.purpose = row.purpose || description(row);
  row.apps = appsOf(row);
  row.searchText = [
    row.title,
    row.name,
    row.purpose,
    row.description,
    row.topic,
    ...row.groups,
    ...row.sources.flatMap((s) => [s.app, s.scope, s.path, s.status]),
  ]
    .join(" ")
    .toLowerCase();
  return row;
}
function queryParts(value) {
  if (!value) return [];
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("zh", { granularity: "word" })
      : null;
  return value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) =>
      segmenter && /[\u4e00-\u9fff]/.test(word)
        ? [...segmenter.segment(word)]
            .filter((s) => s.isWordLike)
            .map((s) => s.segment)
        : [word]
    );
}
function matchesCommon(row, terms) {
  const app = $("app").value;
  return (
    (!app ||
      (app === "shared" ? row.apps.length > 1 : row.apps.includes(app))) &&
    terms.every((t) => row.searchText.includes(t))
  );
}
function groups() {
  const old = $("group").value,
    values = [
      ...new Set(rows.filter((r) => r.kind === kind).flatMap((r) => r.groups)),
    ].sort();
  $("group").replaceChildren(
    new Option("全部类型", ""),
    ...values.map((g) => new Option(g, g))
  );
  if (values.includes(old)) $("group").value = old;
}
function switchTo(key) {
  kind = key;
  topic = "";
  page = 0;
  $("group").value = "";
  groups();
  render();
}
function navigation(common) {
  $("nav").replaceChildren(
    ...Object.entries(sections).map(([key, [label, short, , icon]]) => {
      const b = el("button", undefined, "navitem");
      b.setAttribute("aria-pressed", String(key === kind));
      b.append(
        el("span", icon, "navicon"),
        el("span", label, "navlabel"),
        el("small", String(common.filter((r) => r.kind === key).length), "num")
      );
      b.title = short + " · " + label;
      b.onclick = () => {
        if (location.hash !== "#" + key) location.hash = key;
        else switchTo(key);
      };
      return b;
    })
  );
}
function selectTopic(value) {
  topic = value;
  page = 0;
  render();
  if (value) {
    $("listtitle").focus({ preventScroll: true });
    $("listing").scrollIntoView({ block: "nearest" });
  }
}
function memoryMap(result) {
  const frame = $("map");
  frame.hidden = kind !== "memory";
  if (frame.hidden) return;
  const available = topics
    .map(([name, desc], i) => ({
      name,
      desc,
      i,
      count: result.filter((r) => r.topic === name).length,
    }))
    .filter((t) => t.count);
  if (!available.length) {
    frame.replaceChildren();
    frame.hidden = true;
    return;
  }
  const map = el("div", undefined, "mapgrid"),
    left = el("div", undefined, "branches"),
    right = el("div", undefined, "branches");
  const center = el("button", undefined, "maproot");
  center.append(
    el("small", "主题中心"),
    el("strong", "我的记忆"),
    el("span", result.length + " 条 · 查看全部")
  );
  center.onclick = () => selectTopic("*");
  for (const [index, t] of available.entries()) {
    const b = el("button", undefined, "topic tone" + t.i);
    b.setAttribute("aria-pressed", String(topic === t.name));
    b.append(
      el("strong", t.name),
      el("small", t.desc),
      el("b", String(t.count))
    );
    b.onclick = () => selectTopic(topic === t.name ? "" : t.name);
    (index % 2 ? right : left).append(b);
  }
  map.append(left, center, right);
  frame.replaceChildren(map);
}
function detail(row) {
  const dialog = $("detail"),
    body = $("body");
  $("title").textContent = row.name;
  body.replaceChildren(el("p", row.purpose, "lead"));
  if (row.title !== row.name) body.append(el("code", row.title));
  body.append(
    el(
      "p",
      [row.topic, ...row.groups, "文件更新 " + date(row.updated)]
        .filter(Boolean)
        .join(" · "),
      "meta"
    )
  );
  const sources = el("ul");
  row.sources.forEach((s) => {
    const li = el("li", [s.app, s.scope, s.status].filter(Boolean).join(" · "));
    li.append(el("code", s.path));
    sources.append(li);
  });
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
        pre.textContent = "无法读取原文，请刷新后重试。";
      }
    };
    body.append(fold);
  }
  body.append(el("h3", "来源位置"), sources);
  dialog.showModal();
}
function card(row) {
  const button = el("button", undefined, "asset " + row.kind);
  const top = el("div", undefined, "cardtop");
  top.append(el("small", row.topic || row.groups[0], "category"));
  const sources = el("span", undefined, "sources");
  row.apps.forEach((a) =>
    sources.append(el("span", a, "tag " + a.toLowerCase()))
  );
  top.append(sources);
  button.append(top, el("strong", row.name), el("p", row.purpose));
  if (row.title !== row.name) button.append(el("code", row.title));
  button.onclick = () => detail(row);
  return button;
}
function render() {
  const terms = queryParts($("search").value),
    common = rows.filter((r) => matchesCommon(r, terms));
  navigation(common);
  const [heading, , hint] = sections[kind];
  $("heading").textContent = heading;
  $("hint").textContent = hint;
  $("search").placeholder =
    kind === "memory"
      ? "搜索记忆主题、关键词或来源…"
      : kind === "mcp"
      ? "想连接什么？试试「代码调用关系」"
      : "你想做什么？试试「调试模拟器」";
  let result = common.filter(
    (r) =>
      r.kind === kind &&
      (!$("group").value || r.groups.includes($("group").value))
  );
  memoryMap(result);
  const hasFilter = Boolean(terms.length || $("app").value || $("group").value);
  $("reset").hidden = !hasFilter && !topic;
  $("listing").hidden =
    kind === "memory" && !topic && !hasFilter && result.length > 0;
  $("sort").hidden = $("listing").hidden;
  if ($("listing").hidden) return;
  if (kind === "memory" && topic && topic !== "*")
    result = result.filter((r) => r.topic === topic);
  result.sort(
    (a, b) =>
      ($("sort").value === "recent" ? b.updated - a.updated : 0) ||
      a.name.localeCompare(b.name, "zh-CN")
  );
  page = Math.min(page, Math.max(0, Math.ceil(result.length / pageSize) - 1));
  const offset = page * pageSize,
    slice = result.slice(offset, offset + pageSize);
  $("listtitle").textContent =
    kind === "memory" && topic && topic !== "*"
      ? topic
      : hasFilter
      ? "匹配结果"
      : { skill: "全部工作方法", mcp: "全部连接", memory: "全部记忆" }[kind];
  $("count").textContent = result.length + " 项";
  $("cards").replaceChildren(...slice.map(card));
  if (!slice.length)
    $("cards").append(
      el(
        "p",
        terms.length
          ? "当前分类没有匹配项，可查看其他分类或更换关键词。"
          : "当前筛选下没有条目。",
        "empty"
      )
    );
  $("range").textContent = slice.length
    ? "显示 " + (offset + 1) + "–" + (offset + slice.length) + " 项"
    : "显示 0 项";
  $("prev").disabled = page === 0;
  $("next").disabled = offset + pageSize >= result.length;
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("reload").disabled = true;
  try {
    const resp = await fetch("/api/inventory");
    if (!resp.ok) throw Error();
    const data = await resp.json();
    rows = data.items.map(normalize);
    isDemo = Boolean(data.demo);
    $("mode").textContent = isDemo ? "示例工作区" : "本机工作区";
    $("stamp").textContent =
      "上次扫描 " + new Date(data.scanned).toLocaleTimeString("zh-CN");
    $("alert").hidden = !data.warnings.length;
    $("alert").textContent = "部分来源读取失败：" + data.warnings.join("、");
    groups();
    render();
  } catch {
    $("stamp").textContent = "扫描失败";
    $("alert").hidden = false;
    $("alert").textContent = "无法刷新本机目录，请检查服务后重试。";
  } finally {
    loading = false;
    $("reload").disabled = false;
  }
}
$("listtitle").tabIndex = -1;
$("reload").onclick = refresh;
$("reset").onclick = () => {
  $("app").value = "";
  $("group").value = "";
  $("search").value = "";
  topic = "";
  page = 0;
  render();
};
for (const id of ["app", "group", "sort", "search"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    if (id !== "sort") topic = "";
    page = 0;
    render();
  });
$("prev").onclick = () => {
  page--;
  render();
  $("listing").scrollIntoView({ block: "start" });
};
$("next").onclick = () => {
  page++;
  render();
  $("listing").scrollIntoView({ block: "start" });
};
$("close").onclick = () => $("detail").close();
$("detail").onclick = (e) => {
  if (e.target !== $("detail")) return;
  const r = e.target.getBoundingClientRect();
  if (
    e.clientX < r.left ||
    e.clientX > r.right ||
    e.clientY < r.top ||
    e.clientY > r.bottom
  )
    $("detail").close();
};
window.addEventListener("hashchange", () =>
  switchTo(
    Object.hasOwn(sections, location.hash.slice(1))
      ? location.hash.slice(1)
      : "skill"
  )
);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
setInterval(() => {
  if (!document.hidden && !$("detail").open) refresh();
}, 60000);
refresh();
