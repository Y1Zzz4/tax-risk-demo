const state = {
  reports: [],
  selectedReport: null,
  lastReviewText: "",
  loadingTasks: {},
  chatHistory: [],
  reviewCache: {},
  activeRequests: {},
  riskClues: [],
  selectedRiskCompany: null,
  selectedRiskAdviceContext: null,
  companyAdviceRecords: {},
  reportMode: "",
  wordReport: null,
  selectedWordRiskPointIndex: null,
  wordReviewRecords: {
    full: null,
    riskPoints: {},
  },
  lastWordReviewText: "",
  lastWordReviewContext: null,
  policyResults: null,
  policyFilter: {
    type: "",
    kind: "",
  },
  policyExpandedType: "",
};

const $ = (id) => document.getElementById(id);
const DEMO_CACHE_KEY = "tax-risk-demo-local-cache-v1";

function createEmptyDemoCache() {
  return {
    version: 1,
    updated_at: "",
    smart: {
      riskClues: [],
      companyAdviceRecords: {},
    },
    report: {
      mode: "",
      excel: {
        reports: [],
        reviewCache: {},
        selectedReportKey: "",
      },
      word: {
        wordReport: null,
        wordReviewRecords: { full: null, riskPoints: {} },
        selectedWordRiskPointIndex: null,
      },
    },
  };
}

function readDemoCache() {
  try {
    const raw = window.localStorage.getItem(DEMO_CACHE_KEY);
    if (!raw) return createEmptyDemoCache();
    const parsed = JSON.parse(raw);
    const empty = createEmptyDemoCache();
    return {
      ...empty,
      ...parsed,
      smart: { ...empty.smart, ...(parsed.smart || {}) },
      report: {
        ...empty.report,
        ...(parsed.report || {}),
        excel: { ...empty.report.excel, ...((parsed.report && parsed.report.excel) || {}) },
        word: { ...empty.report.word, ...((parsed.report && parsed.report.word) || {}) },
      },
    };
  } catch (error) {
    console.warn("演示缓存读取失败", error);
    return createEmptyDemoCache();
  }
}

function writeDemoCache(cache) {
  try {
    window.localStorage.setItem(DEMO_CACHE_KEY, JSON.stringify({ ...cache, updated_at: new Date().toISOString() }));
  } catch (error) {
    console.warn("演示缓存写入失败", error);
    showToast("本地演示缓存写入失败，可能是浏览器存储空间不足。");
  }
}

function saveSmartDemoCache() {
  const cache = readDemoCache();
  cache.smart = {
    riskClues: state.riskClues,
    companyAdviceRecords: state.companyAdviceRecords,
  };
  writeDemoCache(cache);
}

function clearSmartDemoCache() {
  const cache = readDemoCache();
  cache.smart = createEmptyDemoCache().smart;
  writeDemoCache(cache);
}

function saveExcelDemoCache() {
  const cache = readDemoCache();
  cache.report.mode = "excel";
  cache.report.excel = {
    reports: state.reports,
    reviewCache: state.reviewCache,
    selectedReportKey: state.selectedReport ? getReportKey(state.selectedReport) : "",
  };
  writeDemoCache(cache);
}

function saveWordDemoCache() {
  const cache = readDemoCache();
  cache.report.mode = "word";
  cache.report.word = {
    wordReport: state.wordReport,
    wordReviewRecords: state.wordReviewRecords,
    selectedWordRiskPointIndex: state.selectedWordRiskPointIndex,
  };
  writeDemoCache(cache);
}

function clearReportDemoCache() {
  const cache = readDemoCache();
  cache.report = createEmptyDemoCache().report;
  writeDemoCache(cache);
}

function showToast(message, type = "error") {
  const toastId = type === "success" ? "successToast" : "errorToast";
  const bodyId = type === "success" ? "successToastBody" : "errorToastBody";
  $(bodyId).textContent = message;
  bootstrap.Toast.getOrCreateInstance($(toastId), { delay: 5000 }).show();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    payload = await response.json();
  }
  if (!response.ok) {
    const detail = payload && payload.detail ? payload.detail : `请求失败：HTTP ${response.status}`;
    throw new Error(Array.isArray(detail) ? JSON.stringify(detail) : detail);
  }
  return payload;
}

function setLoading(button, spinner, isLoading) {
  if (button) button.disabled = isLoading;
  if (spinner) spinner.classList.toggle("d-none", !isLoading);
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} 分 ${remainingSeconds} 秒`;
}

function clearLoadingPanel(panelId) {
  const task = state.loadingTasks[panelId];
  if (task) {
    clearInterval(task.timerId);
    delete state.loadingTasks[panelId];
  }
  const panel = $(panelId);
  if (panel) {
    panel.innerHTML = "";
    panel.className = "d-none";
  }
}

function clearActiveRequest(requestKey) {
  delete state.activeRequests[requestKey];
}

function abortActiveRequest(requestKey, panelId, title) {
  const controller = state.activeRequests[requestKey];
  if (controller) {
    controller.abort();
    clearActiveRequest(requestKey);
  }
  showLoadingStopped(panelId, title);
}

function startLoadingPanel(panelId, config) {
  clearLoadingPanel(panelId);
  const panel = $(panelId);
  const startedAt = Date.now();
  const stages = config.stages || [];
  const stageDurationMs = config.stageDurationMs || 5200;

  panel.innerHTML = "";
  panel.className = "loading-panel";

  const header = document.createElement("div");
  header.className = "loading-panel-header";
  const title = document.createElement("div");
  title.className = "loading-title";
  const spinner = document.createElement("span");
  spinner.className = "spinner-border spinner-border-sm";
  spinner.setAttribute("aria-hidden", "true");
  title.appendChild(spinner);
  appendTextElement(title, "span", config.title);
  const timeStatus = document.createElement("div");
  timeStatus.className = "time-status";
  const elapsed = appendTextElement(timeStatus, "span", "已耗时 0 秒", "elapsed-time");
  if (config.estimatedTime) {
    appendTextElement(timeStatus, "span", `预计用时 ${config.estimatedTime}`, "estimated-time");
  }
  if (config.abort) {
    const abortButton = document.createElement("button");
    abortButton.type = "button";
    abortButton.className = "btn btn-outline-secondary btn-sm abort-btn";
    abortButton.textContent = config.abort.label;
    abortButton.addEventListener("click", config.abort.onClick);
    timeStatus.appendChild(abortButton);
  }
  header.appendChild(timeStatus);
  header.prepend(title);
  panel.appendChild(header);

  if (config.context && config.context.length) {
    const context = document.createElement("div");
    context.className = "loading-context";
    config.context.forEach((item) => {
      const contextItem = document.createElement("div");
      contextItem.className = "context-item";
      appendTextElement(contextItem, "span", item.label, "context-label");
      appendTextElement(contextItem, "span", item.value, "context-value");
      context.appendChild(contextItem);
    });
    panel.appendChild(context);
  }

  const stageList = document.createElement("ul");
  stageList.className = "stage-list";
  const stageElements = stages.map((stage) => {
    const item = document.createElement("li");
    item.className = "stage-item";
    const dot = document.createElement("span");
    dot.className = "stage-dot";
    item.appendChild(dot);
    appendTextElement(item, "span", stage);
    stageList.appendChild(item);
    return item;
  });
  panel.appendChild(stageList);

  appendTextElement(panel, "p", config.note, "loading-note");
  const warning = appendTextElement(panel, "div", "", "loading-warning d-none");

  const update = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    elapsed.textContent = `已耗时 ${formatElapsed(seconds)}`;
    const activeIndex = Math.min(Math.floor((seconds * 1000) / stageDurationMs), Math.max(stages.length - 1, 0));
    stageElements.forEach((element, index) => {
      element.classList.toggle("done", index < activeIndex);
      element.classList.toggle("active", index === activeIndex);
    });
    if (seconds >= 30) {
      warning.textContent = "模型仍在生成结果，请稍候；如长时间无响应，可稍后重新发起本次任务。";
      warning.classList.remove("d-none");
    }
  };

  update();
  state.loadingTasks[panelId] = { timerId: setInterval(update, 1000) };
}

function stopLoadingTimer(panelId) {
  const task = state.loadingTasks[panelId];
  if (task) {
    clearInterval(task.timerId);
    delete state.loadingTasks[panelId];
  }
}

function showLoadingStopped(panelId, title) {
  stopLoadingTimer(panelId);
  const panel = $(panelId);
  panel.innerHTML = "";
  panel.className = "loading-panel stopped";
  const header = document.createElement("div");
  header.className = "loading-panel-header";
  appendTextElement(header, "div", title, "loading-title");
  panel.appendChild(header);
  appendTextElement(panel, "p", "已中止本次前端等待任务。可调整输入内容后重新发起。", "loading-note");
}

function showLoadingError(panelId, title, message) {
  stopLoadingTimer(panelId);
  const panel = $(panelId);
  panel.innerHTML = "";
  panel.className = "loading-panel error";
  const header = document.createElement("div");
  header.className = "loading-panel-header";
  appendTextElement(header, "div", title, "loading-title");
  panel.appendChild(header);
  appendTextElement(panel, "p", message, "loading-note");
  appendTextElement(panel, "p", "请检查网络、模型配置或稍后重试。", "loading-warning");
}

function appendTextElement(parent, tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text || "";
  parent.appendChild(element);
  return element;
}

function renderList(parent, items) {
  const ul = document.createElement("ul");
  (items && items.length ? items : ["未返回明确内容"]).forEach((item) => {
    appendTextElement(ul, "li", item);
  });
  parent.appendChild(ul);
}

function renderChatResult(data, containerId = "chatResult") {
  const container = $(containerId);
  container.innerHTML = "";
  container.className = "result-grid mt-4";
  const answerSummary = data.answer_summary || data.question_understanding || "未返回明确总结";
  const referenceMaterials = data.reference_materials || data.supplementary_materials;

  const cards = [
    ["回答总结", answerSummary, "summary"],
    ["问题理解", data.question_understanding, "text"],
    ["建议核查方向", data.verification_directions, "list"],
    ["建议应对措施", data.suggested_measures, "list"],
    ["参考材料", referenceMaterials, "list"],
    ["风险提示", data.risk_notice, "text-wide"],
  ];

  cards.forEach(([title, content, type]) => {
    const card = document.createElement("article");
    card.className = type === "text-wide" || type === "summary" ? "info-card info-card-wide" : "info-card";
    if (type === "summary") card.classList.add("info-card-summary");
    appendTextElement(card, "h3", title);
    if (type === "list") {
      renderList(card, content);
    } else {
      appendTextElement(card, "p", content);
    }
    container.appendChild(card);
  });

  container.classList.remove("d-none");
}

function groupRiskCluesByCompany() {
  return state.riskClues.reduce((groups, clue) => {
    const key = clue.taxpayer_name || "未识别纳税人名称";
    if (!groups[key]) groups[key] = [];
    groups[key].push(clue);
    return groups;
  }, {});
}

function getRiskCluesForCompany(companyName) {
  return state.riskClues.filter((clue) => clue.taxpayer_name === companyName);
}

function getCompanyAdviceRecords(companyName) {
  return state.companyAdviceRecords[companyName] || [];
}

function formatRiskPeriods(clues) {
  const periods = [...new Set(clues.map((clue) => clue.risk_period).filter(Boolean))];
  return periods.length ? periods.slice(0, 3).join("、") + (periods.length > 3 ? " 等" : "") : "未提供";
}

function riskClueMatches(clue, query) {
  if (!query) return true;
  const haystack = [clue.sequence_no, clue.taxpayer_name, clue.risk_name, clue.risk_period, clue.risk_description]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function riskCompanyMatches(companyName, clues, query) {
  if (!query) return true;
  const haystack = [
    companyName,
    ...clues.flatMap((clue) => [clue.sequence_no, clue.risk_name, clue.risk_period, clue.risk_description]),
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function selectedRiskCompanyClues() {
  return state.selectedRiskCompany ? getRiskCluesForCompany(state.selectedRiskCompany) : [];
}

function renderRiskClueList() {
  const list = $("riskCompanyList");
  const summary = $("riskClueSearchSummary");
  if (!list || !summary) return;
  const query = ($("riskClueSearchInput") && $("riskClueSearchInput").value.trim()) || "";
  const groups = groupRiskCluesByCompany();
  const companies = Object.entries(groups)
    .filter(([companyName, clues]) => riskCompanyMatches(companyName, clues, query))
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"));
  list.innerHTML = "";
  summary.textContent = query
    ? `检索到 ${companies.length} 户企业 / 共 ${Object.keys(groups).length} 户企业`
    : `展示全部 ${companies.length} 户企业，共 ${state.riskClues.length} 条风险疑点`;

  if (!companies.length) {
    const row = document.createElement("tr");
    const cell = appendTextElement(row, "td", "未检索到匹配企业，请调整关键词。", "empty-state");
    cell.colSpan = 6;
    list.appendChild(row);
    return;
  }

  companies.forEach(([companyName, clues]) => {
    const row = document.createElement("tr");
    if (state.selectedRiskCompany === companyName) row.classList.add("active-row");
    appendTextElement(row, "td", companyName);
    appendTextElement(row, "td", `${clues.length} 条`);
    appendTextElement(row, "td", formatRiskPeriods(clues));
    const riskCell = document.createElement("td");
    const riskNames = clues.map((clue) => clue.risk_name || "未提供疑点名称");
    riskCell.textContent = riskNames.slice(0, 3).join("；") + (riskNames.length > 3 ? `；另 ${riskNames.length - 3} 条` : "");
    riskCell.title = riskNames.join("；");
    row.appendChild(riskCell);
    appendTextElement(row, "td", `${getCompanyAdviceRecords(companyName).length} 条`);
    const actions = document.createElement("td");
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "btn btn-sm btn-outline-primary";
    openButton.textContent = "查看风险点";
    openButton.addEventListener("click", () => selectRiskCompany(companyName));
    actions.appendChild(openButton);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function getRiskContextIdForClue(clue) {
  return `single-${clue.row_index}-${clue.sequence_no}`;
}

function renderRiskCompanyMeta(clues) {
  const grid = $("riskCompanyMetaGrid");
  if (!grid) return;
  grid.innerHTML = "";
  [
    ["纳税人名称", state.selectedRiskCompany || "未选择"],
    ["风险点数量", `${clues.length} 条`],
    ["风险所属期", formatRiskPeriods(clues)],
    ["建议记录", `${getCompanyAdviceRecords(state.selectedRiskCompany).length} 条`],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "record-meta-item";
    appendTextElement(item, "span", label, "record-meta-label");
    appendTextElement(item, "span", value, "record-meta-value");
    grid.appendChild(item);
  });
}

function renderCompanyRiskClueList() {
  const list = $("companyRiskClueList");
  const summary = $("companyRiskSearchSummary");
  if (!list || !summary) return;
  const query = ($("companyRiskSearchInput") && $("companyRiskSearchInput").value.trim()) || "";
  const clues = selectedRiskCompanyClues();
  const filtered = clues.filter((clue) => riskClueMatches(clue, query));
  list.innerHTML = "";
  summary.textContent = query
    ? `当前企业检索到 ${filtered.length} 条风险点 / 共 ${clues.length} 条`
    : `当前企业共 ${filtered.length} 条风险点`;

  if (!filtered.length) {
    appendTextElement(list, "div", "当前企业未检索到匹配风险点。", "empty-state");
    return;
  }

  filtered.forEach((clue) => {
    const card = document.createElement("article");
    card.className = "compact-card";
    const isActive =
      state.selectedRiskAdviceContext &&
      (state.selectedRiskAdviceContext.context_id === getRiskContextIdForClue(clue) ||
        state.selectedRiskAdviceContext.context_id === `company-${clue.taxpayer_name}`);
    if (isActive) card.classList.add("active");
    const header = document.createElement("div");
    header.className = "compact-card-header";
    appendTextElement(header, "h3", `${clue.sequence_no}. ${clue.risk_name}`);
    appendTextElement(header, "span", clue.risk_period || "未提供所属期");
    card.appendChild(header);
    appendTextElement(card, "p", formatShortText(clue.risk_description, 220));
    const actions = document.createElement("div");
    actions.className = "compact-card-actions";
    const singleButton = document.createElement("button");
    singleButton.type = "button";
    singleButton.className = "btn btn-sm btn-outline-primary";
    singleButton.textContent = "以本条作为背景";
    singleButton.addEventListener("click", () => selectRiskAdviceContext("single", clue));
    actions.appendChild(singleButton);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function renderRiskCompanyDetail() {
  const clues = selectedRiskCompanyClues();
  if (!state.selectedRiskCompany || !clues.length) {
    $("riskCompanyDetailPanel").classList.add("d-none");
    $("riskCompanyIndexPanel").classList.remove("d-none");
    return;
  }
  $("riskCompanyIndexPanel").classList.add("d-none");
  $("riskCompanyDetailPanel").classList.remove("d-none");
  $("riskCompanyDetailTitle").textContent = state.selectedRiskCompany;
  $("riskCompanyDetailMeta").textContent = `${clues.length} 条风险点 · ${getCompanyAdviceRecords(state.selectedRiskCompany).length} 条建议记录`;
  renderRiskCompanyMeta(clues);
  renderCompanyRiskClueList();
  renderSelectedRiskContext();
  renderAdviceRecords(state.selectedRiskCompany);
}

function selectRiskCompany(companyName) {
  state.selectedRiskCompany = companyName;
  state.selectedRiskAdviceContext = null;
  if ($("companyRiskSearchInput")) $("companyRiskSearchInput").value = "";
  $("riskAdviceInput").value = "";
  $("riskAdviceResult").innerHTML = "";
  $("riskAdviceResult").classList.add("d-none");
  clearLoadingPanel("riskAdviceLoadingPanel");
  renderRiskCompanyDetail();
}

function backToRiskCompanyIndex() {
  state.selectedRiskCompany = null;
  state.selectedRiskAdviceContext = null;
  $("riskCompanyDetailPanel").classList.add("d-none");
  $("riskCompanyIndexPanel").classList.remove("d-none");
  $("selectedRiskCompanyPanel").classList.add("d-none");
  clearLoadingPanel("riskAdviceLoadingPanel");
  $("riskAdviceResult").innerHTML = "";
  $("riskAdviceResult").classList.add("d-none");
  renderRiskClueList();
}

function selectRiskAdviceContext(type, clue = null) {
  const taxpayerName = type === "company" ? state.selectedRiskCompany : clue.taxpayer_name;
  const riskClues = type === "company" ? getRiskCluesForCompany(taxpayerName) : [clue];
  if (!taxpayerName || !riskClues.length) {
    showToast("未找到可作为背景的企业风险点。");
    return;
  }
  state.selectedRiskCompany = taxpayerName;
  state.selectedRiskAdviceContext = {
    context_id: type === "company" ? `company-${taxpayerName}` : getRiskContextIdForClue(clue),
    type,
    taxpayer_name: taxpayerName,
    title: type === "company" ? `${taxpayerName}全部风险疑点` : `${taxpayerName}：${clue.risk_name}`,
    risk_clues: riskClues,
  };
  renderCompanyRiskClueList();
  renderSelectedRiskContext();
  renderAdviceRecords(taxpayerName);
  $("riskAdviceInput").focus();
}

function renderSelectedRiskContext() {
  const context = state.selectedRiskAdviceContext;
  if (!context) {
    $("selectedRiskCompanyPanel").classList.add("d-none");
    return;
  }
  $("selectedRiskCompanyTitle").textContent = `已选背景：${context.title}`;
  $("selectedRiskCompanyMeta").textContent = `${context.risk_clues.length} 条风险疑点 · ${context.type === "company" ? "企业全部疑点" : "单条疑点"}`;
  const container = $("selectedRiskClueBody");
  container.innerHTML = "";
  context.risk_clues.forEach((clue) => {
    const item = document.createElement("div");
    item.className = "context-item-block";
    appendTextElement(item, "strong", `${clue.sequence_no}. ${clue.risk_name}`);
    appendTextElement(item, "span", `${clue.taxpayer_name} · ${clue.risk_period || "未提供所属期"}`);
    appendTextElement(item, "p", clue.risk_description || "未提供风险描述");
    container.appendChild(item);
  });
  $("selectedRiskCompanyPanel").classList.remove("d-none");
}

function clearRiskAdviceContext() {
  state.selectedRiskAdviceContext = null;
  $("riskAdviceInput").value = "";
  $("riskAdviceResult").innerHTML = "";
  $("riskAdviceResult").classList.add("d-none");
  clearLoadingPanel("riskAdviceLoadingPanel");
  renderSelectedRiskContext();
  renderCompanyRiskClueList();
}

function resetRiskClues() {
  if (state.activeRequests.riskAdvice) {
    state.activeRequests.riskAdvice.abort();
    clearActiveRequest("riskAdvice");
  }
  state.riskClues = [];
  state.selectedRiskCompany = null;
  state.selectedRiskAdviceContext = null;
  state.companyAdviceRecords = {};
  if ($("riskClueInput")) $("riskClueInput").value = "";
  if ($("riskClueFileName")) $("riskClueFileName").textContent = "未选择文件";
  if ($("smartFreePanel")) $("smartFreePanel").classList.remove("d-none");
  if ($("smartRiskPanel")) $("smartRiskPanel").classList.add("d-none");
  $("riskClueWorkspace").classList.add("d-none");
  $("riskCompanyIndexPanel").classList.remove("d-none");
  $("riskCompanyDetailPanel").classList.add("d-none");
  $("selectedRiskCompanyPanel").classList.add("d-none");
  $("riskClueResetBtn").classList.add("d-none");
  $("riskClueSearchInput").value = "";
  $("riskCompanyList").innerHTML = "";
  $("riskClueSearchSummary").textContent = "";
  $("companyRiskSearchInput").value = "";
  $("companyRiskClueList").innerHTML = "";
  $("companyRiskSearchSummary").textContent = "";
  $("riskAdviceInput").value = "";
  $("riskAdviceResult").innerHTML = "";
  $("riskAdviceResult").classList.add("d-none");
  clearLoadingPanel("riskAdviceLoadingPanel");
  $("companyAdviceRecordsList").innerHTML = "";
  $("companyAdviceRecordsPanel").classList.add("d-none");
  clearSmartDemoCache();
}

async function handleParseRiskClues() {
  const file = $("riskClueInput").files[0];
  if (!file) {
    showToast("请先选择 .xlsx 疑点清单。");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  setLoading($("riskClueParseBtn"), $("riskClueParseSpinner"), true);
  try {
    const data = await fetchJson("/api/risk-clues/parse", {
      method: "POST",
      body: formData,
    });
    state.riskClues = data.clues || [];
    state.selectedRiskCompany = null;
    state.selectedRiskAdviceContext = null;
    state.companyAdviceRecords = {};
    $("riskClueSummary").textContent = `已解析 ${data.total_count} 条风险点，涉及 ${data.company_count} 户企业`;
    $("smartFreePanel").classList.add("d-none");
    $("smartRiskPanel").classList.remove("d-none");
    $("riskClueWorkspace").classList.remove("d-none");
    $("riskCompanyIndexPanel").classList.remove("d-none");
    $("riskCompanyDetailPanel").classList.add("d-none");
    $("selectedRiskCompanyPanel").classList.add("d-none");
    $("riskClueResetBtn").classList.remove("d-none");
    $("riskClueSearchInput").value = "";
    renderRiskClueList();
    saveSmartDemoCache();
    clearLoadingPanel("riskAdviceLoadingPanel");
    $("riskAdviceResult").innerHTML = "";
    $("riskAdviceResult").classList.add("d-none");
    showToast("疑点清单解析完成。", "success");
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading($("riskClueParseBtn"), $("riskClueParseSpinner"), false);
  }
}

function createAdviceRecord(result, question, options = {}) {
  const now = new Date();
  const context = state.selectedRiskAdviceContext;
  const riskResults = options.riskResults || [];
  return {
    id: `${now.getTime()}`,
    created_at: now.toLocaleString("zh-CN", { hour12: false }),
    taxpayer_name: context.taxpayer_name,
    context_title: context.title,
    context_type: context.type,
    context_scope: context.type === "company" ? "企业全部疑点" : "单条疑点",
    question: question || "根据上传疑点清单生成企业风险应对建议",
    risk_clues: context.risk_clues,
    risk_results: riskResults,
    result,
  };
}

function saveAdviceRecord(record) {
  if (!state.companyAdviceRecords[record.taxpayer_name]) {
    state.companyAdviceRecords[record.taxpayer_name] = [];
  }
  state.companyAdviceRecords[record.taxpayer_name] = [record, ...state.companyAdviceRecords[record.taxpayer_name]].slice(0, 20);
  saveSmartDemoCache();
}

function renderAdviceRecords(companyName) {
  const panel = $("companyAdviceRecordsPanel");
  const list = $("companyAdviceRecordsList");
  if (!panel || !list) return;
  const records = getCompanyAdviceRecords(companyName);
  list.innerHTML = "";
  if (!records.length) {
    panel.classList.add("d-none");
    return;
  }

  records.forEach((record, index) => {
    const item = document.createElement("article");
    item.className = "advice-record-item";
    const info = document.createElement("div");
    appendTextElement(info, "strong", record.context_title || `建议记录 ${records.length - index}`);
    const resultCount = record.risk_results && record.risk_results.length ? record.risk_results.length : record.risk_clues.length;
    appendTextElement(info, "span", `${record.created_at} · ${resultCount} 条风险点 · ${record.context_scope || "应对建议"}`);
    appendTextElement(info, "p", record.question);
    const actions = document.createElement("div");
    actions.className = "advice-record-actions";
    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "btn btn-sm btn-outline-primary";
    viewButton.textContent = "在线查看";
    viewButton.addEventListener("click", () => viewAdviceRecord(record));
    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "btn btn-sm btn-outline-secondary";
    downloadButton.textContent = "保存文件";
    downloadButton.addEventListener("click", () => downloadAdviceRecord(record));
    actions.appendChild(viewButton);
    actions.appendChild(downloadButton);
    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  });
  panel.classList.remove("d-none");
}

function viewAdviceRecord(record) {
  selectRiskCompany(record.taxpayer_name);
  const recordContextId =
    record.context_type === "single" && record.risk_clues && record.risk_clues[0]
      ? getRiskContextIdForClue(record.risk_clues[0])
      : `company-${record.taxpayer_name}`;
  state.selectedRiskAdviceContext = {
    context_id: recordContextId,
    type: record.context_type || "company",
    taxpayer_name: record.taxpayer_name,
    title: record.context_title || record.taxpayer_name,
    risk_clues: record.risk_clues,
  };
  renderSelectedRiskContext();
  renderCompanyRiskClueList();
  renderAdviceRecords(record.taxpayer_name);
  if (record.risk_results && record.risk_results.length) {
    renderRiskAdviceBatchResult(record);
  } else {
    renderChatResult(record.result, "riskAdviceResult");
  }
  $("riskAdviceInput").value = record.question;
  $("riskAdviceResult").scrollIntoView({ behavior: "smooth", block: "start" });
}

function sanitizeFilename(value) {
  return (value || "企业").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

function formatRiskCluesPlainText(clues) {
  const lines = ["| 序号 | 纳税人名称 | 疑点名称 | 风险所属期 | 风险描述 |", "| --- | --- | --- | --- | --- |"];
  clues.forEach((clue) => {
    lines.push(`| ${clue.sequence_no} | ${clue.taxpayer_name} | ${clue.risk_name} | ${clue.risk_period} | ${clue.risk_description} |`);
  });
  return lines.join("\n");
}

function formatAdviceRecordPlainText(record) {
  const baseLines = [
    `纳税人名称：${record.taxpayer_name}`,
    `生成时间：${record.created_at}`,
    `背景范围：${record.context_scope || (record.context_type === "single" ? "单条疑点" : "企业全部疑点")}`,
    `背景名称：${record.context_title || record.taxpayer_name}`,
    `分析要求：${record.question}`,
    "",
    "疑点清单",
    formatRiskCluesPlainText(record.risk_clues),
    "",
  ];

  if (record.risk_results && record.risk_results.length) {
    record.risk_results.forEach((item, index) => {
      const result = item.result || {};
      baseLines.push(
        `风险点${index + 1}：${item.risk_clue.risk_name || "未提供疑点名称"}`,
        `序号：${item.risk_clue.sequence_no}`,
        `风险所属期：${item.risk_clue.risk_period || "未提供"}`,
        `风险描述：${item.risk_clue.risk_description || "未提供"}`,
        "",
        "回答总结",
        result.answer_summary || "",
        "",
        "问题理解",
        result.question_understanding || "",
        "",
        "建议核查方向",
        listToText(result.verification_directions),
        "",
        "建议应对措施",
        listToText(result.suggested_measures),
        "",
        "参考材料",
        listToText(result.reference_materials || result.supplementary_materials),
        "",
        "风险提示",
        result.risk_notice || "",
        "",
      );
    });
    return baseLines.join("\n");
  }

  const result = record.result || {};
  return [
    ...baseLines,
    "回答总结",
    result.answer_summary || "",
    "",
    "问题理解",
    result.question_understanding || "",
    "",
    "建议核查方向",
    listToText(result.verification_directions),
    "",
    "建议应对措施",
    listToText(result.suggested_measures),
    "",
    "参考材料",
    listToText(result.reference_materials || result.supplementary_materials),
    "",
    "风险提示",
    result.risk_notice || "",
  ].join("\n");
}

function downloadAdviceRecord(record) {
  const blob = new Blob([formatAdviceRecordPlainText(record)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(record.taxpayer_name)}_风险应对建议_${record.id}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const knowledgeSearchConfig = {
  policies: {
    inputId: "policySearchInput",
    buttonId: "policySearchBtn",
    spinnerId: "policySpinner",
    resultId: "policySearchResult",
    endpoint: "/api/knowledge/policies/search",
  },
  cases: {
    inputId: "caseSearchInput",
    buttonId: "caseSearchBtn",
    spinnerId: "caseSpinner",
    resultId: "caseSearchResult",
    endpoint: "/api/knowledge/cases/search",
  },
};

function appendKnowledgeFields(parent, fields) {
  const details = document.createElement("details");
  details.className = "knowledge-fields";
  appendTextElement(details, "summary", "查看原始字段");

  const table = document.createElement("table");
  table.className = "table table-sm table-bordered align-middle";
  const tbody = document.createElement("tbody");
  Object.entries(fields || {}).forEach(([label, value]) => {
    const row = document.createElement("tr");
    appendTextElement(row, "th", label);
    appendTextElement(row, "td", value);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  details.appendChild(table);
  parent.appendChild(details);
}

function getPolicyType(item) {
  return (item.fields && item.fields["类型"]) || "未分类";
}

function getPolicyKind(item) {
  return (item.fields && item.fields["种类"]) || "未分类";
}

function renderKnowledgeCards(container, results) {
  const list = document.createElement("div");
  list.className = "knowledge-list";
  results.forEach((item) => {
    const card = document.createElement("article");
    card.className = "knowledge-card";
    appendTextElement(card, "h3", item.title);
    if (item.subtitle) appendTextElement(card, "div", item.subtitle, "knowledge-subtitle");
    appendTextElement(card, "p", item.content_preview);
    appendKnowledgeFields(card, item.fields);
    list.appendChild(card);
  });
  container.appendChild(list);
}

function renderPolicyTreeIndex(results = null) {
  const index = $("policyTreeIndex");
  if (!index) return;
  const items = results || (state.policyResults && state.policyResults.results) || [];
  index.innerHTML = "";
  appendTextElement(index, "h3", "政策索引");

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = !state.policyFilter.type && !state.policyFilter.kind ? "policy-tree-button active" : "policy-tree-button";
  allButton.textContent = `全部政策（${items.length}）`;
  allButton.addEventListener("click", () => {
    state.policyFilter = { type: "", kind: "" };
    state.policyExpandedType = "";
    renderPolicyResultList();
    renderPolicyTreeIndex();
  });
  index.appendChild(allButton);

  const groups = items.reduce((acc, item) => {
    const type = getPolicyType(item);
    const kind = getPolicyKind(item);
    if (!acc[type]) acc[type] = {};
    if (!acc[type][kind]) acc[type][kind] = 0;
    acc[type][kind] += 1;
    return acc;
  }, {});

  Object.entries(groups)
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))
    .forEach(([type, kinds]) => {
      const typeButton = document.createElement("button");
      typeButton.type = "button";
      const isExpanded = state.policyExpandedType === type;
      typeButton.className = state.policyFilter.type === type && !state.policyFilter.kind ? "policy-tree-button has-children active" : "policy-tree-button has-children";
      const typeCount = Object.values(kinds).reduce((sum, value) => sum + value, 0);
      typeButton.textContent = `${isExpanded ? "▾" : "▸"} ${type}（${typeCount}）`;
      typeButton.addEventListener("click", () => {
        state.policyFilter = { type, kind: "" };
        state.policyExpandedType = type;
        renderPolicyResultList();
        renderPolicyTreeIndex();
      });
      index.appendChild(typeButton);

      if (!isExpanded) return;

      const kindList = document.createElement("div");
      kindList.className = "policy-tree-children";
      Object.entries(kinds)
        .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"))
        .forEach(([kind, count]) => {
          const kindButton = document.createElement("button");
          kindButton.type = "button";
          kindButton.className =
            state.policyFilter.type === type && state.policyFilter.kind === kind ? "policy-tree-button child active" : "policy-tree-button child";
          kindButton.textContent = `${kind}（${count}）`;
          kindButton.addEventListener("click", () => {
            state.policyFilter = { type, kind };
            state.policyExpandedType = type;
            renderPolicyResultList();
            renderPolicyTreeIndex();
          });
          kindList.appendChild(kindButton);
        });
      index.appendChild(kindList);
    });
}

function renderPolicyResultList() {
  const container = $("policySearchResult");
  if (!container || !state.policyResults) return;
  const data = state.policyResults;
  const filter = state.policyFilter;
  const filtered = data.results.filter((item) => {
    if (filter.type && getPolicyType(item) !== filter.type) return false;
    if (filter.kind && getPolicyKind(item) !== filter.kind) return false;
    return true;
  });

  container.innerHTML = "";
  const status = document.createElement("div");
  status.className = data.exists ? "knowledge-status" : "knowledge-status warning";
  appendTextElement(status, "strong", filter.type ? `当前索引：${filter.type}${filter.kind ? ` / ${filter.kind}` : ""}` : data.message);
  if (data.exists) {
    appendTextElement(status, "span", `展示 ${filtered.length} 条，当前检索范围 ${data.results.length} 条，数据总记录数 ${data.total_rows}`);
  }
  container.appendChild(status);

  if (!data.exists || !filtered.length) {
    appendTextElement(container, "div", data.exists ? "当前索引下无政策记录，请调整索引或关键词。" : "知识库文件就绪后可直接检索。", "empty-state");
    return;
  }
  renderKnowledgeCards(container, filtered);
}

function renderKnowledgeResult(resultId, data) {
  const container = $(resultId);
  container.innerHTML = "";

  const status = document.createElement("div");
  status.className = data.exists ? "knowledge-status" : "knowledge-status warning";
  appendTextElement(status, "strong", data.message);
  if (data.exists) {
    appendTextElement(status, "span", `数据文件：${data.source_file}，总记录数：${data.total_rows}`);
  }
  container.appendChild(status);

  if (!data.exists || !data.results.length) {
    appendTextElement(container, "div", data.exists ? "未检索到匹配记录，请调整关键词后重试。" : "知识库文件就绪后可直接检索。", "empty-state");
    if (resultId === "policySearchResult") {
      state.policyResults = data;
      state.policyFilter = { type: "", kind: "" };
      state.policyExpandedType = "";
      renderPolicyTreeIndex(data.results);
    }
    return;
  }

  if (resultId === "policySearchResult") {
    state.policyResults = data;
    state.policyFilter = { type: "", kind: "" };
    state.policyExpandedType = "";
    renderPolicyTreeIndex(data.results);
    renderPolicyResultList();
    return;
  }

  renderKnowledgeCards(container, data.results);
}

async function handleKnowledgeSearch(category, limit = null) {
  const config = knowledgeSearchConfig[category];
  const query = $(config.inputId).value.trim();
  setLoading($(config.buttonId), $(config.spinnerId), true);
  try {
    const requestLimit = limit || (category === "policies" ? 3000 : 20);
    const data = await fetchJson(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: requestLimit }),
    });
    renderKnowledgeResult(config.resultId, data);
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading($(config.buttonId), $(config.spinnerId), false);
  }
}

function addChatHistory(question) {
  state.chatHistory = [question, ...state.chatHistory.filter((item) => item !== question)].slice(0, 5);
  renderChatHistory();
}

function renderChatHistory() {
  const panel = $("chatHistoryPanel");
  const list = $("chatHistoryList");
  list.innerHTML = "";

  if (!state.chatHistory.length) {
    panel.classList.add("d-none");
    return;
  }

  state.chatHistory.forEach((question) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent = question.length > 80 ? `${question.slice(0, 80)}...` : question;
    button.title = question;
    button.addEventListener("click", () => {
      $("questionInput").value = question;
      clearLoadingPanel("chatLoadingPanel");
      $("chatResult").innerHTML = "";
      $("chatResult").classList.add("d-none");
      $("questionInput").focus();
      showToast("已填入历史问题，请点击“开始分析”重新生成结果。", "success");
    });
    list.appendChild(button);
  });

  panel.classList.remove("d-none");
}

function clearChatHistory() {
  state.chatHistory = [];
  renderChatHistory();
  showToast("本次会话历史问题已清除。", "success");
}

async function handleChatSubmit() {
  const question = $("questionInput").value.trim();
  if (!question) {
    showToast("请输入需要分析的问题。");
    return;
  }

  setLoading($("chatSubmitBtn"), $("chatSpinner"), true);
  $("chatResult").classList.add("d-none");
  const chatController = new AbortController();
  state.activeRequests.chat = chatController;
  startLoadingPanel("chatLoadingPanel", {
    title: "智能应对任务处理中",
    context: [
      { label: "任务类型", value: "自由提问辅助研判" },
      { label: "分析对象", value: "自由提问" },
      { label: "输入长度", value: `${question.length} 字` },
    ],
    estimatedTime: "通常 10-40 秒",
    stages: ["确认输入", "调用大模型生成辅助研判", "整理结构化结果", "等待结果返回"],
    note: "当前服务仅调用大模型生成一般性研判框架，不自动检索政策法规、历史案例或内部数据。",
    abort: {
      label: "中止本次分析",
      onClick: () => abortActiveRequest("chat", "chatLoadingPanel", "智能应对任务已中止"),
    },
  });
  try {
    const data = await fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal: chatController.signal,
    });
    clearLoadingPanel("chatLoadingPanel");
    renderChatResult(data);
    addChatHistory(question);
  } catch (error) {
    if (error.name === "AbortError") return;
    showLoadingError("chatLoadingPanel", "智能应对任务未完成", error.message);
    showToast(error.message);
  } finally {
    clearActiveRequest("chat");
    setLoading($("chatSubmitBtn"), $("chatSpinner"), false);
  }
}

function resetChat() {
  if (state.activeRequests.chat) {
    state.activeRequests.chat.abort();
    clearActiveRequest("chat");
  }
  $("questionInput").value = "";
  clearLoadingPanel("chatLoadingPanel");
  $("chatResult").innerHTML = "";
  $("chatResult").classList.add("d-none");
}

async function requestRiskAdvice(taxpayerName, riskClues, question, signal) {
  return fetchJson("/api/risk-clues/advice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taxpayer_name: taxpayerName, risk_clues: riskClues, question }),
    signal,
  });
}

function renderRiskAdviceBatchDetail(item, index) {
  const detail = $("riskAdviceBatchDetail");
  if (!detail) return;
  detail.innerHTML = "";
  const clue = item.risk_clue;
  const header = document.createElement("section");
  header.className = "source-record-panel";
  appendTextElement(header, "h3", `风险点${index + 1}：${clue.risk_name || "未提供疑点名称"}`);
  const grid = document.createElement("div");
  grid.className = "record-meta-grid";
  [
    ["序号", clue.sequence_no],
    ["纳税人名称", clue.taxpayer_name],
    ["风险所属期", clue.risk_period || "未提供"],
  ].forEach(([label, value]) => {
    const meta = document.createElement("div");
    meta.className = "record-meta-item";
    appendTextElement(meta, "span", label, "record-meta-label");
    appendTextElement(meta, "span", value, "record-meta-value");
    grid.appendChild(meta);
  });
  header.appendChild(grid);
  appendTextElement(header, "p", clue.risk_description || "未提供风险描述");
  detail.appendChild(header);

  const resultContainer = document.createElement("div");
  resultContainer.id = "riskAdviceBatchDetailResult";
  resultContainer.className = "result-grid mt-4";
  detail.appendChild(resultContainer);
  renderChatResult(item.result, "riskAdviceBatchDetailResult");
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRiskAdviceBatchResult(record) {
  const container = $("riskAdviceResult");
  container.innerHTML = "";
  container.className = "review-result mt-4";

  const summary = document.createElement("section");
  summary.className = "review-summary-panel";
  appendTextElement(summary, "h3", "企业全部疑点应对结果");
  appendTextElement(
    summary,
    "p",
    `已按 ${record.risk_results.length} 个风险点分别生成应对建议。请选择下方风险点查看完整建议，下载文件将包含全部风险点背景和应对结果。`,
  );
  container.appendChild(summary);

  const wrapper = document.createElement("div");
  wrapper.className = "table-responsive";
  const table = document.createElement("table");
  table.className = "table table-bordered align-middle risk-advice-result-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["序号", "疑点名称", "风险所属期", "应对摘要", "操作"].forEach((header) => appendTextElement(headRow, "th", header));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  record.risk_results.forEach((item, index) => {
    const clue = item.risk_clue;
    const result = item.result || {};
    const row = document.createElement("tr");
    appendTextElement(row, "td", clue.sequence_no || String(index + 1));
    appendTextElement(row, "td", clue.risk_name || "未提供疑点名称");
    appendTextElement(row, "td", clue.risk_period || "未提供");
    const summaryCell = appendTextElement(row, "td", formatShortText(result.answer_summary || result.question_understanding, 120));
    summaryCell.title = result.answer_summary || result.question_understanding || "";
    const actionCell = document.createElement("td");
    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "btn btn-sm btn-outline-primary";
    viewButton.textContent = "查看应对详情";
    viewButton.addEventListener("click", () => renderRiskAdviceBatchDetail(item, index));
    actionCell.appendChild(viewButton);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);

  const detail = document.createElement("div");
  detail.id = "riskAdviceBatchDetail";
  detail.className = "risk-advice-detail-panel";
  appendTextElement(detail, "div", "请选择一条风险点查看应对详情。", "empty-state");
  container.appendChild(detail);
  container.classList.remove("d-none");
}

async function handleRiskAdviceSubmit() {
  const context = state.selectedRiskAdviceContext;
  if (!context || !context.risk_clues.length) {
    showToast("请先选择一条疑点或某企业全部疑点作为应对背景。");
    return;
  }
  const question = $("riskAdviceInput").value.trim();
  setLoading($("riskAdviceBtn"), $("riskAdviceSpinner"), true);
  $("riskAdviceResult").classList.add("d-none");
  const adviceController = new AbortController();
  state.activeRequests.riskAdvice = adviceController;
  startLoadingPanel("riskAdviceLoadingPanel", {
    title: "疑点背景智能应对处理中",
    context: [
      { label: "纳税人名称", value: context.taxpayer_name },
      { label: "背景类型", value: context.type === "company" ? "企业全部疑点" : "单条疑点" },
      { label: "风险点数量", value: `${context.risk_clues.length} 条` },
    ],
    estimatedTime: context.type === "company" ? "按风险点数量递增" : "通常 10-50 秒",
    stages: ["确认背景", "提交应对任务", "生成核查方向", "整理应对建议"],
    note:
      context.type === "company"
        ? "企业全部疑点将按风险点逐条生成应对建议，并在结果中按风险点分类展示。"
        : "当前任务基于已选择的下发疑点背景生成辅助应对建议，不自动检索政策法规、历史案例或内部数据。",
    abort: {
      label: "中止本次分析",
      onClick: () => abortActiveRequest("riskAdvice", "riskAdviceLoadingPanel", "疑点背景智能应对已中止"),
    },
  });
  try {
    let data = null;
    let record = null;
    if (context.type === "company") {
      const riskResults = [];
      for (let index = 0; index < context.risk_clues.length; index += 1) {
        const clue = context.risk_clues[index];
        const result = await requestRiskAdvice(context.taxpayer_name, [clue], question, adviceController.signal);
        riskResults.push({
          risk_clue: clue,
          result,
          created_at: new Date().toLocaleString("zh-CN", { hour12: false }),
        });
      }
      record = createAdviceRecord(null, question, { riskResults });
      renderRiskAdviceBatchResult(record);
    } else {
      data = await requestRiskAdvice(context.taxpayer_name, context.risk_clues, question, adviceController.signal);
      renderChatResult(data, "riskAdviceResult");
      record = createAdviceRecord(data, question);
    }
    clearLoadingPanel("riskAdviceLoadingPanel");
    saveAdviceRecord(record);
    renderRiskCompanyMeta(selectedRiskCompanyClues());
    $("riskCompanyDetailMeta").textContent = `${selectedRiskCompanyClues().length} 条风险点 · ${getCompanyAdviceRecords(context.taxpayer_name).length} 条建议记录`;
    renderAdviceRecords(context.taxpayer_name);
    renderRiskClueList();
    showToast("应对建议已生成并保存到本次会话记录。", "success");
  } catch (error) {
    if (error.name === "AbortError") return;
    showLoadingError("riskAdviceLoadingPanel", "疑点背景智能应对未完成", error.message);
    showToast(error.message);
  } finally {
    clearActiveRequest("riskAdvice");
    setLoading($("riskAdviceBtn"), $("riskAdviceSpinner"), false);
  }
}

function formatShortText(value, maxLength = 60) {
  const text = value || "未提供";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getRiskBrief(report) {
  return report.risk_brief || "未提供";
}

function getManualConclusion(report) {
  return report.manual_conclusion || "未提供";
}

function getRectificationStatus(report) {
  return report.rectification_status || "未提供";
}

function getReportMetaItems(report) {
  return [
    ["报告编号", getReportId(report)],
    ["纳税人名称", getTaxpayerName(report)],
    ["风险任务名称", getTaskName(report)],
    ["疑点信息", getRiskBrief(report)],
    ["人工认定结果", getManualConclusion(report)],
    ["申报更正情况", getRectificationStatus(report)],
  ];
}

function appendReportMetaGrid(parent, report) {
  const grid = document.createElement("div");
  grid.className = "record-meta-grid";
  getReportMetaItems(report).forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "record-meta-item";
    appendTextElement(item, "span", label, "record-meta-label");
    appendTextElement(item, "span", value, "record-meta-value");
    grid.appendChild(item);
  });
  parent.appendChild(grid);
}

function renderSelectedReportMeta(report) {
  const container = $("selectedReportMeta");
  container.innerHTML = "";
  appendReportMetaGrid(container, report);
}

function parseTaskNameParts(taskName) {
  const pattern = /^(\d{4}年\d{2}月)(.+?)管理条线(第\d+批)(.+?税务局)(第\d+批)(.+?行业)风险任务$/;
  const match = taskName.match(pattern);
  if (!match) {
    return {
      main: formatShortText(taskName, 18),
      meta: "完整任务名称见详情",
    };
  }
  return {
    main: `${match[1]} · ${match[6]}`,
    meta: `${match[2]} · ${match[3]}`,
  };
}

function appendTaskNameCell(row, report) {
  const taskName = getTaskName(report);
  const parts = parseTaskNameParts(taskName);
  const td = document.createElement("td");
  td.className = "task-name-cell";
  td.title = taskName;
  appendTextElement(td, "span", parts.main, "task-name-main");
  appendTextElement(td, "span", parts.meta, "task-name-meta");
  row.appendChild(td);
}

function renderReportList(reports) {
  const tbody = $("reportListBody");
  tbody.innerHTML = "";
  reports.forEach((report, index) => {
    const tr = document.createElement("tr");
    appendTextElement(tr, "td", getReportId(report));
    appendTextElement(tr, "td", getTaxpayerName(report));
    appendTaskNameCell(tr, report);
    const riskTd = appendTextElement(tr, "td", formatShortText(getRiskBrief(report)));
    riskTd.title = getRiskBrief(report);
    appendTextElement(tr, "td", getManualConclusion(report));
    const previewTd = document.createElement("td");
    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "btn btn-sm btn-outline-secondary";
    previewButton.textContent = "查看";
    previewButton.title = `查看情况说明（${report.text_length} 字）`;
    previewButton.addEventListener("click", () => openReportTextModal(index));
    previewTd.appendChild(previewButton);
    tr.appendChild(previewTd);
    const statusTd = document.createElement("td");
    const cached = Boolean(state.reviewCache[getReportKey(report)]);
    appendTextElement(statusTd, "span", cached ? "已复核" : "待复核", cached ? "status-badge done" : "status-badge pending");
    tr.appendChild(statusTd);
    const resultTd = document.createElement("td");
    const resultButton = document.createElement("button");
    resultButton.type = "button";
    resultButton.className = cached ? "btn btn-sm btn-outline-primary" : "btn btn-sm btn-outline-secondary";
    resultButton.textContent = cached ? "查看结果" : "暂无结果";
    resultButton.disabled = !cached;
    resultButton.addEventListener("click", () => viewReportReviewResultFromList(index));
    resultTd.appendChild(resultButton);
    tr.appendChild(resultTd);
    const actionTd = document.createElement("td");
    const button = document.createElement("button");
    button.className = "btn btn-sm btn-outline-primary";
    button.textContent = cached ? "重新复核" : "开始复核";
    button.addEventListener("click", () => selectReport(index));
    actionTd.appendChild(button);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
}

function openReportTextModal(index) {
  const report = state.reports[index];
  if (!report) {
    showToast("未找到对应情况说明，请重新解析文件。");
    return;
  }
  $("reportTextModalTitle").textContent = `情况说明：${getTaxpayerName(report)}`;
  $("reportTextModalBody").textContent = report.full_text || "未提供情况说明。";
  bootstrap.Modal.getOrCreateInstance($("reportTextModal")).show();
}

function viewReportReviewResultFromList(index) {
  const report = state.reports[index];
  if (!report) {
    showToast("未找到对应报告，请重新解析文件。");
    return;
  }
  const cachedResult = state.reviewCache[getReportKey(report)];
  if (!cachedResult) {
    showToast("该报告暂无复核结果，请先点击“开始复核”。");
    return;
  }
  state.selectedReport = report;
  state.lastReviewText = "";
  $("selectedReportTitle").textContent = `情况说明预览：${getTaxpayerName(report)}`;
  renderSelectedReportMeta(report);
  $("reportPreview").textContent = report.full_text;
  clearLoadingPanel("reviewLoadingPanel");
  $("reviewBtnLabel").textContent = "重新复核";
  $("selectStage").classList.add("d-none");
  $("reviewStage").classList.remove("d-none");
  renderReviewResult(cachedResult, { fromCache: true });
  saveExcelDemoCache();
  $("reviewResult").scrollIntoView({ behavior: "smooth", block: "start" });
}

function getReportId(report) {
  return report.record_id || `报告记录 ${report.row_index || ""}`.trim();
}

function getTaxpayerName(report) {
  return report.taxpayer_name || "未识别纳税人名称";
}

function getTaskName(report) {
  return report.task_name || report.preview || "未识别风险任务名称";
}

function getReportKey(report) {
  return report.record_id || `row-${report.row_index}`;
}

async function parseExcelReportFile(file, button = null, spinner = null) {
  if (!file) {
    showToast("请先选择 .xlsx 文件。");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  setLoading(button, spinner, true);
  try {
    const data = await fetchJson("/api/report/parse", {
      method: "POST",
      body: formData,
    });
    state.reports = data.reports || [];
    state.selectedReport = null;
    state.lastReviewText = "";
    state.reviewCache = {};
    state.reportMode = "excel";
    renderReportList(state.reports);
    if ($("reportExcelPanel")) $("reportExcelPanel").classList.remove("d-none");
    if ($("reportWordPanel")) $("reportWordPanel").classList.add("d-none");
    if ($("reportUnifiedResetBtn")) $("reportUnifiedResetBtn").classList.remove("d-none");
    $("selectStage").classList.remove("d-none");
    $("reviewStage").classList.add("d-none");
    saveExcelDemoCache();
    showToast("Excel 报告清单解析完成。", "success");
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading(button, spinner, false);
  }
}

function selectReport(index) {
  if (state.activeRequests.review) {
    state.activeRequests.review.abort();
    clearActiveRequest("review");
  }
  state.selectedReport = state.reports[index];
  state.lastReviewText = "";
  $("selectedReportTitle").textContent = `情况说明预览：${getTaxpayerName(state.selectedReport)}`;
  renderSelectedReportMeta(state.selectedReport);
  $("reportPreview").textContent = state.selectedReport.full_text;
  $("reviewResult").innerHTML = "";
  $("reviewResult").classList.add("d-none");
  clearLoadingPanel("reviewLoadingPanel");
  $("copyReviewBtn").classList.add("d-none");
  $("downloadReviewBtn").classList.add("d-none");
  const cachedResult = state.reviewCache[getReportKey(state.selectedReport)];
  $("reviewBtnLabel").textContent = cachedResult ? "重新复核" : "开始复核";
  $("selectStage").classList.add("d-none");
  $("reviewStage").classList.remove("d-none");
  if (cachedResult) {
    renderReviewResult(cachedResult, { fromCache: true });
  }
  saveExcelDemoCache();
}

function resetUpload() {
  resetUnifiedReportUpload();
}

function resetExcelReportState() {
  if (state.activeRequests.review) {
    state.activeRequests.review.abort();
    clearActiveRequest("review");
  }
  state.reports = [];
  state.selectedReport = null;
  state.lastReviewText = "";
  state.reviewCache = {};
  state.reportMode = "";
  $("reportListBody").innerHTML = "";
  $("selectedReportMeta").innerHTML = "";
  $("reviewResult").innerHTML = "";
  $("reviewResult").classList.add("d-none");
  $("copyReviewBtn").classList.add("d-none");
  $("downloadReviewBtn").classList.add("d-none");
  clearLoadingPanel("reviewLoadingPanel");
  $("selectStage").classList.add("d-none");
  $("reviewStage").classList.add("d-none");
}

function backToList() {
  $("reviewStage").classList.add("d-none");
  renderReportList(state.reports);
  $("selectStage").classList.remove("d-none");
}

function appendTable(parent, headers, rows, fields) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-responsive";
  const table = document.createElement("table");
  table.className = "table table-bordered align-middle";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((header) => appendTextElement(headRow, "th", header));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    fields.forEach((field) => appendTextElement(tr, "td", row[field] || ""));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

function appendSection(parent, title) {
  return appendTextElement(parent, "h3", title);
}

function appendBullets(parent, title, items) {
  appendTextElement(parent, "p", title, "fw-semibold mb-1");
  renderList(parent, items);
}

function appendOriginalReportInfo(parent, report) {
  if (!report) return;
  const panel = document.createElement("section");
  panel.className = "source-record-panel";
  appendTextElement(panel, "h3", "任务及人工处理信息");
  appendReportMetaGrid(panel, report);
  parent.appendChild(panel);
}

const REVIEW_DISCLAIMER =
  "免责声明：本复核结果由系统依据上传材料和内置检查规则生成，仅用于辅助报告质量复核，不替代税务机关正式审核、执法判断或业务审批意见。";

function normalizeObjectTitle(objectTitle) {
  return (objectTitle || "未识别复核对象").replace(/^复核对象[：:]\s*/, "").replace(/^报告分析对象[：:]\s*/, "");
}

function appendReviewConclusionPanel(parent, data, objectTitle, summary = null, riskLabel = null) {
  const panel = document.createElement("section");
  panel.className = "review-conclusion-panel";
  appendTextElement(panel, "h3", "复核结论");
  const meta = document.createElement("div");
  meta.className = "review-object-meta";
  appendTextElement(meta, "span", "复核对象", "review-object-label");
  appendTextElement(meta, "strong", normalizeObjectTitle(objectTitle), "review-object-name");
  panel.appendChild(meta);
  appendTextElement(panel, "p", summary || buildShortReviewConclusion(data, riskLabel));
  parent.appendChild(panel);
}

const REVIEW_INDICATORS = [
  { key: "structure", name: "结构完整性", good: "结构完整" },
  { key: "completeness", name: "应对完整性", good: "应对完整" },
  { key: "compliance", name: "应对合规性", good: "应对措施规范" },
  { key: "expression", name: "表述规范性", good: "表述规范" },
  { key: "data_consistency", name: "数据一致性", good: "数据口径未见明显异常" },
];

function joinReviewPhrases(items, fallback) {
  if (!items.length) return fallback;
  if (items.length <= 3) return items.join("、");
  return `${items.slice(0, 3).join("、")}等方面表现正常`;
}

function getMatrixIssueNames(row) {
  return REVIEW_INDICATORS
    .filter((item) => row[item.key] && row[item.key].tone !== "good")
    .map((item) => item.name);
}

function buildShortReviewConclusion(data, riskLabel = null) {
  const row = getReviewMatrixRow(data, riskLabel);
  const positiveText = joinReviewPhrases(
    REVIEW_INDICATORS
      .filter((item) => row[item.key] && row[item.key].tone === "good")
      .map((item) => item.good),
    "已完成结构化复核",
  );
  const issueNames = getMatrixIssueNames(row);
  const scope = riskLabel ? "该风险点报告" : "该报告";
  if (!issueNames.length) {
    return `${scope}${positiveText}，未发现明显影响复核结论的问题，建议按业务流程进行人工确认。`;
  }
  const target = riskLabel ? `“${formatShortText(row.risk_label, 42)}”` : "报告";
  return `${scope}${positiveText}，但${target}在${issueNames.join("、")}方面存在问题或需要关注，建议结合复核详情补充核实依据、过程记录和表述口径。`;
}

function makeReviewSymbol(symbol, label, tone) {
  return { symbol, label, tone };
}

function aggregateEnumStatus(values, positive, partial, negative) {
  if (!values.length) return makeReviewSymbol("△", "无法判断", "warn");
  if (values.some((value) => negative.includes(value))) return makeReviewSymbol("×", "存在问题", "bad");
  if (values.some((value) => partial.includes(value))) return makeReviewSymbol("△", "需要关注", "warn");
  if (values.every((value) => positive.includes(value))) return makeReviewSymbol("✓", "通过", "good");
  return makeReviewSymbol("△", "无法判断", "warn");
}

function reviewKeywordStatus(data) {
  const status = data.keyword_check ? data.keyword_check.status || "" : "";
  const content = data.keyword_check ? data.keyword_check.content || "" : "";
  if (status.includes("未发现") || content.includes("未发现明显问题")) return makeReviewSymbol("✓", "未命中", "good");
  if (status.includes("发现") || content.includes("可能存在") || content.includes("需要进一步")) {
    return makeReviewSymbol("×", "命中", "bad");
  }
  return makeReviewSymbol("△", "待人工确认", "warn");
}

function getReviewMatrixRow(data, label) {
  const structureValues = (data.structure_analysis.rows || []).map((row) => row.match_status);
  const completenessValues = (data.response_completeness_check.rows || []).map((row) => row.coverage_status);
  const complianceValues = (data.response_conclusion_check.rows || []).map((row) => row.compliance_judgment || row.match_status);
  const expressionRows = buildExpressionRows(data);
  const expressionIssues = expressionRows.filter((row) => row.item !== "是否满足数据一致性要求？" && row.result !== "未发现明显问题");
  const dataConsistency = expressionRows.find((row) => row.item === "是否满足数据一致性要求？");
  const structure = aggregateEnumStatus(structureValues, ["匹配"], ["部分匹配"], ["未匹配"]);
  const completeness = aggregateEnumStatus(completenessValues, ["已覆盖"], ["部分覆盖", "无法判断"], ["未覆盖"]);
  const compliance = aggregateEnumStatus(complianceValues, ["规范", "匹配"], ["基本规范", "部分匹配", "无法判断"], ["不规范", "未匹配"]);
  const expression = expressionIssues.length
    ? makeReviewSymbol("×", "存在疑点", "bad")
    : makeReviewSymbol("✓", "未见异常", "good");
  const dataStatus =
    dataConsistency && dataConsistency.result === "未发现明显问题"
      ? makeReviewSymbol("✓", "未见异常", "good")
      : dataConsistency && dataConsistency.result === "存在疑点"
        ? makeReviewSymbol("×", "存在疑点", "bad")
        : makeReviewSymbol("△", "需核对", "warn");
  const overall = worstMatrixStatus([structure, completeness, compliance, expression, dataStatus]);
  return {
    risk_label: label || inferRiskLabel(data),
    structure,
    completeness,
    compliance,
    expression,
    data_consistency: dataStatus,
    overall,
  };
}

function worstMatrixStatus(statuses) {
  if (statuses.some((status) => status.tone === "bad")) return makeReviewSymbol("×", "存在问题", "bad");
  if (statuses.some((status) => status.tone === "warn")) return makeReviewSymbol("△", "需关注", "warn");
  return makeReviewSymbol("✓", "通过", "good");
}

function inferRiskLabel(data) {
  const conclusionRow = data.response_conclusion_check.rows && data.response_conclusion_check.rows[0];
  if (conclusionRow && conclusionRow.risk_point) return conclusionRow.risk_point;
  const completenessRow = data.response_completeness_check.rows && data.response_completeness_check.rows[0];
  if (completenessRow && completenessRow.assigned_issue) return completenessRow.assigned_issue;
  return data.report_object || "报告整体";
}

function getStatusTone(status) {
  if (["匹配", "已覆盖", "支撑充分", "较完整", "规范"].includes(status)) return "good";
  if (["未匹配", "未覆盖", "支撑不足", "待完善", "不规范"].includes(status)) return "bad";
  return "warn";
}

function statusText(value, fallback = "无法判断") {
  return value || fallback;
}

function hasProblemStatus(status) {
  return ["未匹配", "未覆盖", "支撑不足", "待完善", "不规范"].includes(status);
}

function hasAttentionStatus(status) {
  return ["部分匹配", "部分覆盖", "无法判断", "部分支撑", "基本完整"].includes(status);
}

function summarizeStatuses(rows, field, allGoodText, problemText, attentionText) {
  const values = (rows || []).map((row) => row[field]).filter(Boolean);
  if (!values.length) return "未返回可判断的结构化结果，建议人工复核。";
  if (values.some(hasProblemStatus)) return problemText;
  if (values.some(hasAttentionStatus)) return attentionText;
  return allGoodText;
}

function getStructureSummary(data) {
  return data.structure_analysis.note || summarizeStatuses(
    data.structure_analysis.rows,
    "match_status",
    "报告结构要素基本完整，标题或语义表述能够匹配规范要求。",
    "报告结构存在缺失或未匹配事项，需补充完善对应内容。",
    "报告结构基本可识别，但部分要素表述不够充分，建议进一步规范。",
  );
}

function getCompletenessSummary(data) {
  return data.response_completeness_check.conclusion || summarizeStatuses(
    data.response_completeness_check.rows,
    "coverage_status",
    "报告中的风险核实情况已覆盖下发疑点。",
    "报告中的风险核实情况未充分覆盖下发疑点。",
    "报告中的风险核实情况仅部分覆盖下发疑点，需补充核实过程或证据。",
  );
}

function getComplianceSummary(data) {
  return data.response_conclusion_check.conclusion || summarizeStatuses(
    data.response_conclusion_check.rows,
    "match_status",
    "风险点所采取的应对措施与核实情况基本匹配，未发现明显不规范表述。",
    "部分风险点应对措施与核实情况不匹配或支撑不足，需重点复核。",
    "部分风险点应对措施尚需结合核实情况、政策依据和数据来源进一步确认。",
  );
}

function getPolicyBasisFromText(text) {
  const value = text || "";
  if (/[政策依据条款规定办法通知公告]/.test(value)) return formatShortText(value, 120);
  return "未提供";
}

function mapComplianceJudgment(row) {
  if (row.compliance_judgment) return row.compliance_judgment;
  if (row.match_status === "匹配") return "规范";
  if (row.match_status === "未匹配") return "不规范";
  if (row.match_status === "部分匹配") return "基本规范";
  return "无法判断";
}

function buildComplianceRows(data) {
  const completenessRows = data.response_completeness_check.rows || [];
  const conclusionRows = data.response_conclusion_check.rows || [];
  const rows = conclusionRows.length ? conclusionRows : completenessRows.map((row) => ({ risk_point: row.assigned_issue }));
  return rows.map((row, index) => {
    const completeness =
      completenessRows.find((item) => item.assigned_issue && row.risk_point && item.assigned_issue === row.risk_point) ||
      completenessRows[index] ||
      {};
    const riskPoint = row.risk_point || completeness.assigned_issue || `风险点${index + 1}`;
    const overview = row.risk_summary || completeness.assigned_issue || riskPoint;
    const treatment = row.treatment_measure || "未发现明确应对措施，建议人工复核";
    const dataSource = row.data_source || completeness.data_support || "未发现明确数据来源";
    return {
      risk_point: riskPoint,
      risk_summary: overview,
      treatment_measure: treatment,
      policy_basis: row.policy_basis || getPolicyBasisFromText(`${treatment} ${dataSource}`),
      data_source: dataSource,
      compliance_judgment: mapComplianceJudgment(row),
    };
  });
}

function getKeywordHitList(keywordCheck, field) {
  if (!keywordCheck || !Array.isArray(keywordCheck[field])) return [];
  return keywordCheck[field].filter(Boolean);
}

function hasStructuredKeywordCheck(keywordCheck) {
  return Boolean(
    keywordCheck &&
      ["self_statement_hits", "sensitive_transfer_hits", "unfinished_hits"].some((field) => Array.isArray(keywordCheck[field])),
  );
}

function getKeywordScopeNote(keywordCheck) {
  const length = Number(keywordCheck && keywordCheck.checked_text_length);
  return length ? `检查范围：已检索 ${length} 字。` : "检查范围：已检索报告正文。";
}

function formatKeywordNote(keywordCheck, hits, noHitText, fallbackIssue) {
  if (hits.length) return `命中 ${hits.length} 处：${hits.join("；")}`;
  if (fallbackIssue) return keywordCheck.content || "命中疑点，建议查看原文。";
  return `${noHitText}${getKeywordScopeNote(keywordCheck)}`;
}

function buildExpressionSummary(data) {
  const keywordCheck = data.keyword_check || {};
  const rows = buildExpressionRows(data);
  const issues = rows.filter((row) => row.item !== "是否满足数据一致性要求？" && row.result !== "未发现明显问题");
  if (!issues.length) {
    return `按企业自述、敏感词未移送稽查、不确定表述三类规则完成检索，未发现明显表述规范性问题。${getKeywordScopeNote(keywordCheck)}`;
  }
  return `按表述规范性规则检索发现 ${issues.length} 类问题，请结合命中句和报告原文核实。${getKeywordScopeNote(keywordCheck)}`;
}

function buildExpressionRows(data) {
  const keywordCheck = data.keyword_check || {};
  const content = keywordCheck.content || "";
  const hasStructured = hasStructuredKeywordCheck(keywordCheck);
  const selfHits = getKeywordHitList(keywordCheck, "self_statement_hits");
  const sensitiveHits = getKeywordHitList(keywordCheck, "sensitive_transfer_hits");
  const unfinishedHits = getKeywordHitList(keywordCheck, "unfinished_hits");
  const fallbackSelfIssue = !hasStructured && /发现企业自述类表达|以纳税人自查代替税务机关核实/.test(content);
  const fallbackSensitiveIssue = !hasStructured && /风险核实情况或应对结论中出现|需要进一步核实是否需要移送稽查/.test(content);
  const fallbackUncertaintyIssue = !hasStructured && /存在未完成、待核实或待整改表述|风险应对尚未完成/.test(content);
  const selfIssue = selfHits.length || fallbackSelfIssue;
  const sensitiveIssue = sensitiveHits.length || fallbackSensitiveIssue;
  const uncertaintyIssue = unfinishedHits.length || fallbackUncertaintyIssue;
  const dataIssue = hasDataConsistencyIssue(data);
  return [
    {
      item: "是否存在企业自述表达（如“我公司”“企业表示”等）？",
      result: selfIssue ? "存在疑点" : "未发现明显问题",
      note: formatKeywordNote(keywordCheck, selfHits, "未命中企业自述类表达。", fallbackSelfIssue),
    },
    {
      item: "是否涉及“暴力虚开”“团伙”“移送稽查”等敏感词？",
      result: sensitiveIssue ? "需进一步核实" : "未发现明显问题",
      note: formatKeywordNote(keywordCheck, sensitiveHits, "未命中疑似应移送稽查但未说明的敏感词句。", fallbackSensitiveIssue),
    },
    {
      item: "是否存在不确定表述？",
      result: uncertaintyIssue ? "存在不确定表述" : "未发现明显问题",
      note: formatKeywordNote(keywordCheck, unfinishedHits, "未命中风险应对尚未完成类表述。", fallbackUncertaintyIssue),
    },
    {
      item: "是否满足数据一致性要求？",
      result: dataIssue.result,
      note: dataIssue.note,
    },
  ];
}

function hasDataConsistencyIssue(data) {
  const evidenceText = [
    ...((data.response_completeness_check.rows || []).map((row) => row.data_support || "")),
    data.manual_conclusion_support_check ? data.manual_conclusion_support_check.gap_analysis : "",
    data.review_summary ? data.review_summary.analysis_conclusion : "",
  ].join(" ");
  if (/不一致|矛盾|冲突|前后不一/.test(evidenceText)) {
    return { result: "存在疑点", note: "报告中存在数据不一致、前后矛盾或冲突表述，需人工核对。" };
  }
  if (/未发现明确数据支撑|未提供|无法判断|信息不足/.test(evidenceText)) {
    return { result: "需人工核对", note: "报告中部分数据来源或支撑材料不充分，建议核对数据口径、期间和来源。" };
  }
  return { result: "未发现明显问题", note: "未发现明显数据不一致表述，仍建议结合底册、申报表和取证材料核对。" };
}

function appendReviewTemplateSection(parent, title, summary) {
  const section = document.createElement("section");
  section.className = "review-template-section";
  appendTextElement(section, "h3", title);
  appendTextElement(section, "p", summary, "review-section-summary");
  parent.appendChild(section);
  return section;
}

function appendSingleReviewTemplate(parent, data, riskLabel = null) {
  const structureSection = appendReviewTemplateSection(parent, "一、结构完整性检查", getStructureSummary(data));
  appendTable(
    structureSection,
    ["标题规范表述", "实际表述", "是否匹配"],
    data.structure_analysis.rows || [],
    ["standard_title", "actual_expression", "match_status"],
  );

  const completenessSection = appendReviewTemplateSection(
    parent,
    "二、应对完整性检查",
    getCompletenessSummary(data),
  );
  appendTable(
    completenessSection,
    ["风险点", "风险核实情况", "数据支撑", "是否覆盖"],
    data.response_completeness_check.rows || [],
    ["assigned_issue", "verification_status", "data_support", "coverage_status"],
  );

  const complianceSection = appendReviewTemplateSection(
    parent,
    "三、应对合规性检查",
    getComplianceSummary(data),
  );
  appendTable(
    complianceSection,
    ["风险点", "风险点概述", "应对措施", "政策依据", "数据来源", "合规性判断"],
    buildComplianceRows(data),
    ["risk_point", "risk_summary", "treatment_measure", "policy_basis", "data_source", "compliance_judgment"],
  );

  const expressionSection = appendReviewTemplateSection(parent, "四、表述规范性检查", buildExpressionSummary(data));
  appendTable(
    expressionSection,
    ["检查事项", "检查结果", "说明"],
    buildExpressionRows(data),
    ["item", "result", "note"],
  );

  const conclusionSection = appendReviewTemplateSection(parent, "五、复核结论", buildShortReviewConclusion(data, riskLabel));
  appendTextElement(conclusionSection, "p", REVIEW_DISCLAIMER, "review-disclaimer");
}

function appendReviewStatusCell(row, status) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `review-symbol ${status.tone}`;
  badge.textContent = status.symbol;
  badge.title = status.label;
  cell.appendChild(badge);
  appendTextElement(cell, "span", status.label, "review-symbol-label");
  row.appendChild(cell);
}

function appendReviewMatrix(parent, rows) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-responsive";
  const table = document.createElement("table");
  table.className = "table table-bordered align-middle review-matrix-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["风险点", "结构完整性", "应对完整性", "应对合规性", "表述规范性", "数据一致性", "综合判断"].forEach((header) => {
    appendTextElement(headRow, "th", header);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((item) => {
    const row = document.createElement("tr");
    appendTextElement(row, "td", item.risk_label);
    appendReviewStatusCell(row, item.structure);
    appendReviewStatusCell(row, item.completeness);
    appendReviewStatusCell(row, item.compliance);
    appendReviewStatusCell(row, item.expression);
    appendReviewStatusCell(row, item.data_consistency);
    appendReviewStatusCell(row, item.overall);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

function appendReviewSummaryPanel(parent, data) {
  const panel = document.createElement("section");
  panel.className = "review-summary-panel";
  appendTextElement(panel, "h3", "复核总结");
  const summaryItems = [
    getStructureSummary(data),
    getCompletenessSummary(data),
    getComplianceSummary(data),
    data.review_summary.analysis_conclusion,
  ].filter(Boolean);
  renderList(panel, summaryItems);
  appendTextElement(panel, "p", data.review_summary.analysis_conclusion || data.final_review_opinion, "summary-status");
  parent.appendChild(panel);
}

function appendReviewDetailSections(parent, data, options = {}) {
  if (options.sourceRenderer) {
    options.sourceRenderer(parent);
  } else {
    appendOriginalReportInfo(parent, state.selectedReport);
  }

  appendSection(parent, "一、报告摘要");
  appendTextElement(parent, "p", data.report_summary);

  appendSection(parent, "二、报告结构分析");
  appendTable(
    parent,
    ["标题规范表述", "实际表述", "是否匹配"],
    data.structure_analysis.rows || [],
    ["standard_title", "actual_expression", "match_status"],
  );
  appendTextElement(parent, "p", `说明：${data.structure_analysis.note}`);

  appendSection(parent, "三、关键字检查");
  appendTextElement(parent, "p", buildExpressionSummary(data));

  appendSection(parent, "四、应对完整性检查");
  appendTable(
    parent,
    ["下发疑点", "报告中风险核实情况", "是否覆盖", "数据支撑"],
    data.response_completeness_check.rows || [],
    ["assigned_issue", "verification_status", "coverage_status", "data_support"],
  );
  appendTextElement(parent, "p", `说明：${data.response_completeness_check.note}`);
  appendTextElement(parent, "p", `结论：${data.response_completeness_check.conclusion}`);

  appendSection(parent, "五、应对结论检查");
  appendTable(
    parent,
    ["风险点", "处理措施", "语义匹配情况"],
    data.response_conclusion_check.rows || [],
    ["risk_point", "treatment_measure", "match_status"],
  );
  appendTextElement(parent, "p", `说明：${data.response_conclusion_check.note}`);
  appendTextElement(parent, "p", `提示：${data.response_conclusion_check.tip}`);
  appendTextElement(parent, "p", `结论：${data.response_conclusion_check.conclusion}`);

  appendSection(parent, "六、人工认定结果支撑性检查");
  appendTable(
    parent,
    ["人工认定结果", "支撑状态", "支撑依据", "缺口分析", "结论"],
    data.manual_conclusion_support_check ? [data.manual_conclusion_support_check] : [],
    ["manual_conclusion", "support_status", "evidence_summary", "gap_analysis", "conclusion"],
  );

  appendSection(parent, "七、应对质效评估");
  appendTextElement(parent, "p", `总体评价：${data.quality_evaluation.overall_level}`);
  appendBullets(parent, "已体现的优点", data.quality_evaluation.strengths);
  appendBullets(parent, "待完善问题", data.quality_evaluation.deficiencies);
  appendBullets(parent, "修改建议", data.quality_evaluation.improvement_suggestions);

  appendSection(parent, "八、复核情况总结");
  appendBullets(parent, "具体情况", data.review_summary.specific_situation);
  appendTextElement(parent, "p", `分析结论：${data.review_summary.analysis_conclusion}`);

  appendSection(parent, "最终复核意见");
  appendTextElement(parent, "p", data.final_review_opinion);
}

function renderReviewResult(data, options = {}) {
  const container = $(options.containerId || "reviewResult");
  container.innerHTML = "";
  container.className = "review-result mt-4";

  if (options.fromCache) {
    appendTextElement(container, "div", "已展示本次页面会话中生成的复核结果。如需重新调用模型，请点击“重新复核”。", "cache-notice");
  }

  const objectTitle = options.objectTitle || `复核对象：${data.report_object}`;
  appendReviewConclusionPanel(container, data, objectTitle, null, options.riskLabel);
  appendSection(container, "复核表格");
  appendReviewMatrix(container, [getReviewMatrixRow(data, options.riskLabel)]);
  appendReviewSummaryPanel(container, data);

  const detail = document.createElement("details");
  detail.className = "review-detail-details";
  appendTextElement(detail, "summary", "展开复核详情");
  if (options.sourceRenderer) {
    options.sourceRenderer(detail);
  } else {
    appendOriginalReportInfo(detail, state.selectedReport);
  }
  appendSingleReviewTemplate(detail, data, options.riskLabel);
  container.appendChild(detail);

  const plainText = options.plainTextFormatter ? options.plainTextFormatter(data) : formatReviewPlainText(data);
  if (options.textTarget === "word") {
    state.lastWordReviewText = plainText;
  } else {
    state.lastReviewText = plainText;
  }
  container.classList.remove("d-none");
  const copyButton = $(options.copyButtonId || "copyReviewBtn");
  if (copyButton) copyButton.classList.remove("d-none");
  const downloadButtonId = options.downloadButtonId || (options.textTarget === "word" ? null : "downloadReviewBtn");
  if (downloadButtonId) {
    const downloadButton = $(downloadButtonId);
    if (downloadButton) downloadButton.classList.remove("d-none");
  }
}

function tableToText(headers, rows, fields) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  rows.forEach((row) => {
    lines.push(`| ${fields.map((field) => row[field] || "").join(" | ")} |`);
  });
  return lines.join("\n");
}

function listToText(items) {
  return (items || []).map((item) => `- ${item}`).join("\n");
}

function formatOriginalReportPlainText(report) {
  if (!report) return "";
  return [
    "任务及人工处理信息",
    ...getReportMetaItems(report).map(([label, value]) => `${label}：${value}`),
  ].join("\n");
}

function formatReviewPlainText(data, options = {}) {
  const lines = [];
  const originalReportText = options.includeOriginal === false ? "" : formatOriginalReportPlainText(state.selectedReport);
  const objectTitle = options.objectTitle || `复核对象：${data.report_object}`;
  if (originalReportText) {
    lines.push(originalReportText, "");
  }
  lines.push(
    objectTitle,
    "",
    "复核结论",
    buildShortReviewConclusion(data, options.riskLabel),
    "",
    "一、结构完整性检查",
    getStructureSummary(data),
    "",
    tableToText(["标题规范表述", "实际表述", "是否匹配"], data.structure_analysis.rows || [], ["standard_title", "actual_expression", "match_status"]),
    "",
    "二、应对完整性检查",
    getCompletenessSummary(data),
    "",
    tableToText(["风险点", "风险核实情况", "数据支撑", "是否覆盖"], data.response_completeness_check.rows || [], ["assigned_issue", "verification_status", "data_support", "coverage_status"]),
    "",
    "三、应对合规性检查",
    getComplianceSummary(data),
    "",
    tableToText(["风险点", "风险点概述", "应对措施", "政策依据", "数据来源", "合规性判断"], buildComplianceRows(data), ["risk_point", "risk_summary", "treatment_measure", "policy_basis", "data_source", "compliance_judgment"]),
    "",
    "四、表述规范性检查",
    tableToText(["检查事项", "检查结果", "说明"], buildExpressionRows(data), ["item", "result", "note"]),
    "",
    "五、复核结论",
    buildShortReviewConclusion(data, options.riskLabel),
    "",
    REVIEW_DISCLAIMER,
  );
  return lines.join("\n");
}

function appendWordReportInfo(parent) {
  if (!state.wordReport) return;
  const panel = document.createElement("section");
  panel.className = "source-record-panel";
  appendTextElement(panel, "h3", "Word 报告解析信息");
  const grid = document.createElement("div");
  grid.className = "record-meta-grid";
  const context = state.lastWordReviewContext;
  const items = [
    ["文件名", state.wordReport.filename],
    ["全文长度", `${state.wordReport.text_length} 字`],
    ["识别风险点", `${state.wordReport.risk_points.length} 个`],
    ["解析警告", `${state.wordReport.warnings.length} 条`],
  ];
  if (context) {
    items.push(["复核范围", context.scope_label]);
    if (context.risk_point) {
      items.push(["当前风险点", `风险点${formatWordRiskPointLabel(context.risk_point)}：${context.risk_point.title}`]);
    }
  }
  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "record-meta-item";
    appendTextElement(item, "span", label, "record-meta-label");
    appendTextElement(item, "span", value, "record-meta-value");
    grid.appendChild(item);
  });
  panel.appendChild(grid);
  parent.appendChild(panel);
}

function formatWordReviewObjectTitle(data, context = state.lastWordReviewContext) {
  if (!context) return `复核对象：${data.report_object}`;
  if (context.risk_point) {
    return `复核对象：风险点${formatWordRiskPointLabel(context.risk_point)}｜${context.risk_point.title}`;
  }
  return `复核对象：全体风险点｜${data.report_object}`;
}

function formatWordRiskPointPlainText(point) {
  if (!point) return "";
  return [
    `风险点${formatWordRiskPointLabel(point)}：${point.title}`,
    `风险点具体描述：${point.description || "未识别"}`,
    `验证情况：${point.verification || "未识别"}`,
    `政策依据：${point.policy_basis || "未识别"}`,
    `拟处理意见：${point.proposed_opinion || point.proposed_opinion_status || "未识别"}`,
  ].join("\n");
}

function createWordReviewContext(scope, point) {
  return {
    scope,
    scope_label: scope === "risk_point" && point ? `单风险点复核：风险点${formatWordRiskPointLabel(point)}` : "全体风险点逐项复核",
    risk_point: point || null,
    created_at: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
}

function formatWordSourcePlainText(context = state.lastWordReviewContext) {
  if (!state.wordReport) return "";
  const lines = [
    "Word 报告解析信息",
    `文件名：${state.wordReport.filename}`,
    `全文长度：${state.wordReport.text_length} 字`,
    `识别风险点：${state.wordReport.risk_points.length} 个`,
    `解析警告：${state.wordReport.warnings.length} 条`,
  ];
  if (context) {
    lines.push(`复核范围：${context.scope_label}`, `生成时间：${context.created_at}`);
  }
  if (state.wordReport.warnings.length) {
    lines.push("", "解析警告", listToText(state.wordReport.warnings));
  }
  if (context && context.risk_point) {
    lines.push("", "当前风险点背景", formatWordRiskPointPlainText(context.risk_point));
  }
  return lines.join("\n");
}

function formatWordReviewPlainText(data, context = state.lastWordReviewContext) {
  const sourceText = formatWordSourcePlainText(context);
  const reviewText = formatReviewPlainText(data, {
    includeOriginal: false,
    objectTitle: formatWordReviewObjectTitle(data, context),
    riskLabel: context && context.risk_point ? `风险点${formatWordRiskPointLabel(context.risk_point)}：${context.risk_point.title}` : null,
  });
  return sourceText ? `${sourceText}\n\n${reviewText}` : reviewText;
}

function getWordReviewRecordKey(scope, point) {
  return scope === "risk_point" && point ? String(point.index) : "full";
}

function createWordReviewRecord(data, context) {
  const key = getWordReviewRecordKey(context.scope, context.risk_point);
  return {
    id: `${Date.now()}`,
    key,
    scope: context.scope,
    created_at: context.created_at,
    context,
    data,
    plain_text: formatWordReviewPlainText(data, context),
  };
}

function saveWordReviewRecord(record) {
  if (record.scope === "risk_point") {
    state.wordReviewRecords.riskPoints[record.key] = record;
  } else {
    state.wordReviewRecords.full = record;
  }
  saveWordDemoCache();
}

function getWordReviewRecord(scope, point = null) {
  if (scope === "risk_point") {
    return point ? state.wordReviewRecords.riskPoints[String(point.index)] || null : null;
  }
  return state.wordReviewRecords.full;
}

function setCurrentWordReviewRecord(record) {
  state.lastWordReviewContext = record.context;
  state.lastWordReviewText = record.plain_text;
}

function renderWordReviewRecordCard(container, record, emptyText) {
  if (!container) return;
  container.innerHTML = "";
  if (!record) {
    if (emptyText) appendTextElement(container, "div", emptyText, "empty-state");
    container.classList.toggle("d-none", !emptyText);
    return;
  }

  const header = document.createElement("div");
  header.className = "review-record-header";
  const title = record.scope === "risk_point" ? "当前风险点复核记录" : "全体风险点复核记录";
  appendTextElement(header, "strong", title);
  appendTextElement(header, "span", `${record.context.scope_label} · ${record.created_at}`);
  container.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "review-record-actions";
  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.className = "btn btn-sm btn-outline-primary";
  viewButton.textContent = "查看结果";
  viewButton.addEventListener("click", () => viewWordReviewRecord(record));
  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "btn btn-sm btn-outline-secondary";
  downloadButton.textContent = "保存文件";
  downloadButton.addEventListener("click", () => downloadWordReviewRecord(record));
  actions.appendChild(viewButton);
  actions.appendChild(downloadButton);
  container.appendChild(actions);
  container.classList.remove("d-none");
}

function renderWordReviewRecordPanels() {
  renderWordReviewRecordCard($("wordFullReviewRecord"), getWordReviewRecord("full"), "");
  renderWordReviewRecordCard($("selectedWordReviewRecord"), getWordReviewRecord("risk_point", selectedWordRiskPoint()), "");
}

function clearWordReviewDisplay() {
  if (state.activeRequests.wordReview) {
    state.activeRequests.wordReview.abort();
    clearActiveRequest("wordReview");
  }
  state.lastWordReviewText = "";
  state.lastWordReviewContext = null;
  $("wordReviewResult").innerHTML = "";
  $("wordReviewResult").classList.add("d-none");
  $("copyWordReviewBtn").classList.add("d-none");
  $("downloadWordReviewBtn").classList.add("d-none");
  clearLoadingPanel("wordReviewLoadingPanel");
}

function viewWordReviewRecord(record) {
  setCurrentWordReviewRecord(record);
  if (record.risk_results && record.risk_results.length) {
    renderWordBatchReviewResult(record);
    $("wordReviewResult").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  renderReviewResult(record.data, {
    containerId: "wordReviewResult",
    copyButtonId: "copyWordReviewBtn",
    downloadButtonId: "downloadWordReviewBtn",
    textTarget: "word",
    sourceRenderer: appendWordReportInfo,
    objectTitle: formatWordReviewObjectTitle(record.data, record.context),
    plainTextFormatter: () => record.plain_text,
  });
  $("wordReviewResult").scrollIntoView({ behavior: "smooth", block: "start" });
}

function downloadWordReviewRecord(record) {
  const baseName = state.wordReport && state.wordReport.filename ? state.wordReport.filename.replace(/\.[^.]+$/, "") : "Word完整报告";
  const scopeName = record.context.risk_point ? `风险点${formatWordRiskPointLabel(record.context.risk_point)}` : "全体风险点复核";
  const blob = new Blob([record.plain_text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(baseName)}_${sanitizeFilename(scopeName)}_AI复核报告.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function appendWordRiskPointInfo(parent, point) {
  const panel = document.createElement("section");
  panel.className = "source-record-panel";
  appendTextElement(panel, "h3", `风险点${formatWordRiskPointLabel(point)}：${point.title}`);
  const grid = document.createElement("div");
  grid.className = "record-meta-grid";
  [
    ["拟处理意见", point.proposed_opinion_status || "未识别"],
    ["验证情况长度", `${(point.verification || "").length} 字`],
    ["政策依据", point.policy_basis ? "已提供" : "未提供"],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "record-meta-item";
    appendTextElement(item, "span", label, "record-meta-label");
    appendTextElement(item, "span", value, "record-meta-value");
    grid.appendChild(item);
  });
  panel.appendChild(grid);
  appendTextElement(panel, "p", point.description || "未识别风险点具体描述");
  parent.appendChild(panel);
}

function formatWordBatchPlainText(record) {
  const lines = [
    formatWordSourcePlainText(record.context),
    "",
    "全体风险点复核结果",
    `生成时间：${record.created_at}`,
    `风险点数量：${record.risk_results.length}`,
    `整体复核结论：${buildBatchConclusionParagraph(record)}`,
    "",
    "全量复核总结",
    ...buildBatchRiskSummaryItems(record).map((item) => `- ${item}`),
    "",
  ];
  record.risk_results.forEach((item, index) => {
    const point = item.point;
    lines.push(
      `风险点${formatWordRiskPointLabel(point)}：${point.title}`,
      `序号：${index + 1}`,
      formatReviewPlainText(item.data, {
        includeOriginal: false,
        objectTitle: formatWordReviewObjectTitle(item.data, item.context),
        riskLabel: `风险点${formatWordRiskPointLabel(point)}：${point.title}`,
      }),
      "",
    );
  });
  return lines.join("\n");
}

function createWordBatchReviewRecord(pointRecords, context) {
  const record = {
    id: `${Date.now()}`,
    key: "full",
    scope: "full",
    created_at: context.created_at,
    context,
    risk_results: pointRecords.map((item) => ({
      point: item.context.risk_point,
      context: item.context,
      data: item.data,
      plain_text: item.plain_text,
    })),
    plain_text: "",
  };
  record.plain_text = formatWordBatchPlainText(record);
  return record;
}

function formatBatchRiskLabel(point) {
  return `风险点${formatWordRiskPointLabel(point)}：${point.title}`;
}

function collectBatchStructureRows(record) {
  return record.risk_results.flatMap((item) =>
    (item.data.structure_analysis.rows || []).map((row) => ({
      risk_point: formatBatchRiskLabel(item.point),
      standard_title: row.standard_title,
      actual_expression: row.actual_expression,
      match_status: row.match_status,
    })),
  );
}

function collectBatchCompletenessRows(record) {
  return record.risk_results.flatMap((item) =>
    (item.data.response_completeness_check.rows || []).map((row) => ({
      risk_point: formatBatchRiskLabel(item.point),
      verification_status: row.verification_status,
      data_support: row.data_support,
      coverage_status: row.coverage_status,
    })),
  );
}

function collectBatchComplianceRows(record) {
  return record.risk_results.flatMap((item) =>
    buildComplianceRows(item.data).map((row) => ({
      ...row,
      risk_point: formatBatchRiskLabel(item.point),
    })),
  );
}

function summarizeBatchIndicator(record, label, getStatus) {
  const problemPoints = [];
  const attentionPoints = [];
  record.risk_results.forEach((item) => {
    const status = getStatus(item.data);
    const riskLabel = formatBatchRiskLabel(item.point);
    if (status === "bad") problemPoints.push(riskLabel);
    else if (status === "warn") attentionPoints.push(riskLabel);
  });
  if (!problemPoints.length && !attentionPoints.length) return `${label}全部通过。`;
  const parts = [];
  if (problemPoints.length) parts.push(`${problemPoints.slice(0, 3).join("、")}存在明确问题`);
  if (attentionPoints.length) parts.push(`${attentionPoints.slice(0, 3).join("、")}需进一步关注`);
  return `${label}在${parts.join("，")}。`;
}

function buildBatchRiskSummaryItems(record) {
  const rows = record.risk_results.map((item) => ({
    label: formatBatchRiskLabel(item.point),
    matrix: getReviewMatrixRow(item.data, formatBatchRiskLabel(item.point)),
  }));
  const issueRows = rows
    .map((row) => ({
      ...row,
      problemNames: REVIEW_INDICATORS.filter((indicator) => row.matrix[indicator.key] && row.matrix[indicator.key].tone === "bad").map(
        (indicator) => indicator.name,
      ),
      attentionNames: REVIEW_INDICATORS.filter((indicator) => row.matrix[indicator.key] && row.matrix[indicator.key].tone === "warn").map(
        (indicator) => indicator.name,
      ),
    }))
    .filter((row) => row.problemNames.length || row.attentionNames.length);
  const passedCount = rows.length - issueRows.length;
  const items = [
    `本次共完成 ${rows.length} 个风险点逐项复核，其中 ${passedCount} 个风险点未发现明显问题，${issueRows.length} 个风险点存在问题或需进一步关注。`,
  ];
  if (!issueRows.length) {
    items.push("各风险点在结构完整性、应对完整性、应对合规性、表述规范性和数据一致性方面均未见明显异常。");
    return items;
  }
  issueRows.slice(0, 6).forEach((row) => {
    const parts = [];
    if (row.problemNames.length) parts.push(`${row.problemNames.join("、")}存在问题`);
    if (row.attentionNames.length) parts.push(`${row.attentionNames.join("、")}需关注`);
    items.push(`${formatShortText(row.label, 52)}：${parts.join("；")}。`);
  });
  if (issueRows.length > 6) {
    items.push(`另有 ${issueRows.length - 6} 个风险点存在问题或需关注，请结合复核表格逐项查看。`);
  }
  return items;
}

function batchStatusFromRows(rows, field) {
  const values = (rows || []).map((row) => row[field]).filter(Boolean);
  if (values.some(hasProblemStatus)) return "bad";
  if (!values.length || values.some(hasAttentionStatus)) return "warn";
  return "good";
}

function buildBatchOverallSummary(record) {
  const summaries = [
    summarizeBatchIndicator(record, "结构完整性", (data) => batchStatusFromRows(data.structure_analysis.rows, "match_status")),
    summarizeBatchIndicator(record, "应对完整性", (data) => batchStatusFromRows(data.response_completeness_check.rows, "coverage_status")),
    summarizeBatchIndicator(record, "应对合规性", (data) => batchStatusFromRows(data.response_conclusion_check.rows, "match_status")),
    summarizeBatchIndicator(record, "表述规范性", (data) =>
      buildExpressionRows(data).some((row) => row.result !== "未发现明显问题") ? "warn" : "good",
    ),
  ];
  return summaries.join("");
}

function buildBatchConclusionParagraph(record) {
  const rows = record.risk_results.map((item) => getReviewMatrixRow(item.data, formatBatchRiskLabel(item.point)));
  const positiveText = joinReviewPhrases(
    REVIEW_INDICATORS
      .filter((indicator) => rows.length && rows.every((row) => row[indicator.key] && row[indicator.key].tone === "good"))
      .map((indicator) => indicator.good),
    "已完成逐风险点复核",
  );
  const issueRows = rows.filter((row) => getMatrixIssueNames(row).length);
  if (!issueRows.length) {
    return `整篇报告${positiveText}，未发现明显影响复核结论的问题，建议按业务流程进行人工确认。`;
  }
  const issueText = issueRows
    .slice(0, 3)
    .map((row) => `“${formatShortText(row.risk_label, 36)}”在${getMatrixIssueNames(row).join("、")}方面存在问题或需要关注`)
    .join("；");
  const remainingText = issueRows.length > 3 ? `；另有 ${issueRows.length - 3} 个风险点需结合复核表格继续处理` : "";
  return `整篇报告${positiveText}，但${issueText}${remainingText}，建议优先补充问题风险点的核实过程、数据支撑和处理依据。`;
}

function buildBatchExpressionRows(record) {
  const labels = [
    "是否存在企业自述表达（如“我公司”“企业表示”等）？",
    "是否涉及“暴力虚开”“团伙”“移送稽查”等敏感词？",
    "是否存在不确定表述？",
    "是否满足数据一致性要求？",
  ];
  return labels.map((label) => {
    const issuePoints = [];
    const notes = [];
    record.risk_results.forEach((item) => {
      const row = buildExpressionRows(item.data).find((entry) => entry.item === label);
      if (!row) return;
      if (row.result !== "未发现明显问题") {
        issuePoints.push(formatBatchRiskLabel(item.point));
        notes.push(row.note);
      }
    });
    return {
      item: label,
      result: issuePoints.length ? `${issuePoints.length} 个风险点需关注` : "全部通过",
      note: issuePoints.length
        ? `${issuePoints.slice(0, 4).join("、")}：${formatShortText([...new Set(notes)].join("；"), 180)}`
        : "未发现明显问题。",
    };
  });
}

function renderWordBatchReviewResult(record) {
  const container = $("wordReviewResult");
  container.innerHTML = "";
  container.className = "review-result mt-4";

  const objectTitle = state.wordReport
    ? `复核对象：全体风险点｜${state.wordReport.filename}`
    : "复核对象：全体风险点";
  const batchConclusion = buildBatchConclusionParagraph(record);
  appendReviewConclusionPanel(container, record.risk_results[0].data, objectTitle, batchConclusion);

  appendSection(container, "复核表格");
  appendReviewMatrix(
    container,
    record.risk_results.map((item) => getReviewMatrixRow(item.data, formatBatchRiskLabel(item.point))),
  );

  const summary = document.createElement("section");
  summary.className = "review-summary-panel";
  appendTextElement(summary, "h3", "复核总结");
  renderList(summary, buildBatchRiskSummaryItems(record));
  appendTextElement(summary, "p", "全量复核已按风险点分别生成结果，可在风险点列表中查看或保存单点复核记录。", "summary-status");
  container.appendChild(summary);

  const detail = document.createElement("details");
  detail.className = "review-detail-details";
  appendTextElement(detail, "summary", "展开复核详情");
  appendTextElement(detail, "p", "全量复核按风险点逐项生成，以下可展开查看单个风险点的完整复核详情。", "summary-status");
  record.risk_results.forEach((item, index) => {
    const riskDetail = document.createElement("details");
    riskDetail.className = "risk-review-detail";
    const riskLabel = formatBatchRiskLabel(item.point);
    appendTextElement(riskDetail, "summary", `${index + 1}. ${riskLabel}`);
    appendWordRiskPointInfo(riskDetail, item.point);
    appendSingleReviewTemplate(riskDetail, item.data, riskLabel);
    detail.appendChild(riskDetail);
  });
  container.appendChild(detail);

  state.lastWordReviewContext = record.context;
  state.lastWordReviewText = record.plain_text;
  $("copyWordReviewBtn").classList.remove("d-none");
  $("downloadWordReviewBtn").classList.remove("d-none");
  container.classList.remove("d-none");
}

function wordRiskPointMatches(point, query) {
  if (!query) return true;
  const haystack = [
    point.index,
    point.label,
    point.title,
    point.description,
    point.verification,
    point.policy_basis,
    point.proposed_opinion,
    point.proposed_opinion_status,
    point.raw_text,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function formatWordRiskPointLabel(point) {
  return point.label || point.index;
}

function renderWordRiskPointList() {
  const list = $("wordRiskPointBody");
  const summary = $("wordRiskSearchSummary");
  if (!state.wordReport || !list || !summary) return;
  const query = ($("wordRiskSearchInput") && $("wordRiskSearchInput").value.trim()) || "";
  const points = state.wordReport.risk_points.filter((point) => wordRiskPointMatches(point, query));
  list.innerHTML = "";
  summary.textContent = query
    ? `检索到 ${points.length} 个风险点 / 共 ${state.wordReport.risk_points.length} 个`
    : `展示全部 ${points.length} 个风险点`;

  if (!points.length) {
    appendTextElement(list, "div", "未检索到匹配风险点，请调整关键词。", "empty-state");
    return;
  }

  points.forEach((point) => {
    const record = getWordReviewRecord("risk_point", point);
    const card = document.createElement("article");
    card.className = "compact-card";
    if (state.selectedWordRiskPointIndex === point.index) card.classList.add("active");
    const header = document.createElement("div");
    header.className = "compact-card-header";
    appendTextElement(header, "h3", `风险点${formatWordRiskPointLabel(point)}：${point.title}`);
    appendTextElement(
      header,
      "span",
      `${record ? "已复核 · " : ""}拟处理意见：${point.proposed_opinion_status || "未识别"}`,
    );
    card.appendChild(header);
    appendTextElement(card, "p", formatShortText(point.description || point.raw_text, 180));
    const actions = document.createElement("div");
    actions.className = "compact-card-actions";
    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "btn btn-sm btn-outline-primary";
    viewButton.textContent = "查看风险详情";
    viewButton.addEventListener("click", () => selectWordRiskPoint(point.index));
    actions.appendChild(viewButton);
    if (record) {
      const viewRecordButton = document.createElement("button");
      viewRecordButton.type = "button";
      viewRecordButton.className = "btn btn-sm btn-outline-secondary";
      viewRecordButton.textContent = "查看复核结果";
      viewRecordButton.addEventListener("click", () => viewWordReviewRecord(record));
      const downloadRecordButton = document.createElement("button");
      downloadRecordButton.type = "button";
      downloadRecordButton.className = "btn btn-sm btn-outline-secondary";
      downloadRecordButton.textContent = "保存复核结果";
      downloadRecordButton.addEventListener("click", () => downloadWordReviewRecord(record));
      actions.appendChild(viewRecordButton);
      actions.appendChild(downloadRecordButton);
    }
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function selectedWordRiskPoint() {
  if (!state.wordReport || state.selectedWordRiskPointIndex == null) return null;
  return state.wordReport.risk_points.find((point) => point.index === state.selectedWordRiskPointIndex) || null;
}

function renderSelectedWordRiskPoint() {
  const point = selectedWordRiskPoint();
  const panel = $("selectedWordRiskPanel");
  if (!panel || !point) {
    if (panel) panel.classList.add("d-none");
    const button = $("wordReviewPointBtn");
    if (button) button.disabled = true;
    const recordPanel = $("selectedWordReviewRecord");
    if (recordPanel) {
      recordPanel.innerHTML = "";
      recordPanel.classList.add("d-none");
    }
    return;
  }
  $("selectedWordRiskTitle").textContent = `风险点${formatWordRiskPointLabel(point)}：${point.title}`;
  $("selectedWordRiskMeta").textContent = `拟处理意见：${point.proposed_opinion_status || "未识别"}`;
  const detail = $("selectedWordRiskDetail");
  detail.innerHTML = "";
  [
    ["风险点具体描述", point.description || "未识别"],
    ["验证情况", point.verification || "未识别"],
    ["政策依据", point.policy_basis || "未识别"],
    ["拟处理意见", point.proposed_opinion || point.proposed_opinion_status || "未识别"],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "context-item-block";
    appendTextElement(item, "strong", label);
    appendTextElement(item, "p", value);
    detail.appendChild(item);
  });
  panel.classList.remove("d-none");
  $("wordReviewPointBtn").disabled = false;
  renderWordReviewRecordPanels();
}

function selectWordRiskPoint(index) {
  state.selectedWordRiskPointIndex = index;
  clearWordReviewDisplay();
  renderWordRiskPointList();
  renderSelectedWordRiskPoint();
  renderWordReviewRecordPanels();
  saveWordDemoCache();
}

function renderWordReportParsed(data) {
  state.wordReport = data;
  state.reportMode = "word";
  state.selectedWordRiskPointIndex = null;
  state.wordReviewRecords = { full: null, riskPoints: {} };
  state.lastWordReviewText = "";
  state.lastWordReviewContext = null;
  $("wordReportSummary").textContent = `已解析 ${data.filename}，全文 ${data.text_length} 字，识别 ${data.risk_points.length} 个风险点`;
  $("wordReportPreview").textContent = data.full_text.length > 4000 ? `${data.full_text.slice(0, 4000)}\n……（全文较长，仅展示前 4000 字；复核仍使用后端保留的完整解析结果）` : data.full_text;
  $("copyWordReviewBtn").classList.add("d-none");
  $("downloadWordReviewBtn").classList.add("d-none");
  $("wordReviewResult").innerHTML = "";
  $("wordReviewResult").classList.add("d-none");
  clearLoadingPanel("wordReviewLoadingPanel");

  const warnings = $("wordParseWarnings");
  warnings.innerHTML = "";
  if (data.warnings && data.warnings.length) {
    appendTextElement(warnings, "strong", "解析提示");
    const list = document.createElement("ul");
    data.warnings.forEach((warning) => appendTextElement(list, "li", warning));
    warnings.appendChild(list);
    warnings.classList.remove("d-none");
  } else {
    warnings.classList.add("d-none");
  }

  const meta = $("wordReportMeta");
  meta.innerHTML = "";
  [
    ["应对任务基本情况", data.basic_info ? formatShortText(data.basic_info, 120) : "未识别"],
    ["任务具体情况总体概括", data.task_summary ? formatShortText(data.task_summary, 120) : "未识别"],
    ["全文长度", `${data.text_length} 字`],
    ["风险点数量", `${data.risk_points.length} 个`],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "record-meta-item";
    appendTextElement(item, "span", label, "record-meta-label");
    appendTextElement(item, "span", value, "record-meta-value");
    meta.appendChild(item);
  });

  $("wordRiskSearchInput").value = "";
  renderWordRiskPointList();
  renderSelectedWordRiskPoint();
  renderWordReviewRecordPanels();
  $("wordParsedStage").classList.remove("d-none");
  if ($("reportWordPanel")) $("reportWordPanel").classList.remove("d-none");
  if ($("reportExcelPanel")) $("reportExcelPanel").classList.add("d-none");
  if ($("reportUnifiedResetBtn")) $("reportUnifiedResetBtn").classList.remove("d-none");
}

function resetWordReport() {
  if (state.activeRequests.wordReview) {
    state.activeRequests.wordReview.abort();
    clearActiveRequest("wordReview");
  }
  state.wordReport = null;
  state.selectedWordRiskPointIndex = null;
  state.wordReviewRecords = { full: null, riskPoints: {} };
  state.lastWordReviewText = "";
  state.lastWordReviewContext = null;
  $("wordParsedStage").classList.add("d-none");
  $("wordRiskPointBody").innerHTML = "";
  $("wordRiskSearchSummary").textContent = "";
  $("wordReportMeta").innerHTML = "";
  $("selectedWordRiskPanel").classList.add("d-none");
  $("wordFullReviewRecord").innerHTML = "";
  $("wordFullReviewRecord").classList.add("d-none");
  $("selectedWordReviewRecord").innerHTML = "";
  $("selectedWordReviewRecord").classList.add("d-none");
  $("wordReviewResult").innerHTML = "";
  $("wordReviewResult").classList.add("d-none");
  $("copyWordReviewBtn").classList.add("d-none");
  $("downloadWordReviewBtn").classList.add("d-none");
  clearLoadingPanel("wordReviewLoadingPanel");
}

async function parseWordReportFile(file, button = null, spinner = null) {
  if (!file) {
    showToast("请先选择 .docx Word 报告。");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  setLoading(button, spinner, true);
  try {
    const data = await fetchJson("/api/report/word/parse", {
      method: "POST",
      body: formData,
    });
    renderWordReportParsed(data);
    saveWordDemoCache();
    showToast("Word 报告解析完成。", "success");
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading(button, spinner, false);
  }
}

async function handleWordReview(scope = "full") {
  if (!state.wordReport) {
    showToast("请先解析 Word 报告。");
    return;
  }
  const point = selectedWordRiskPoint();
  if (scope === "risk_point" && !point) {
    showToast("请先选择需要复核的风险点。");
    return;
  }
  if (scope === "full" && !state.wordReport.risk_points.length) {
    showToast("当前 Word 报告未解析出风险点，无法执行全体风险点复核。");
    return;
  }

  const button = scope === "risk_point" ? $("wordReviewPointBtn") : $("wordReviewAllBtn");
  const spinner = scope === "risk_point" ? $("wordReviewPointSpinner") : $("wordReviewAllSpinner");
  setLoading(button, spinner, true);
  $("wordReviewResult").classList.add("d-none");
  $("copyWordReviewBtn").classList.add("d-none");
  $("downloadWordReviewBtn").classList.add("d-none");
  const reviewContext = createWordReviewContext(scope, point);
  const reviewController = new AbortController();
  state.activeRequests.wordReview = reviewController;
  startLoadingPanel("wordReviewLoadingPanel", {
    title: scope === "risk_point" ? "单风险点复核任务处理中" : "全体风险点逐项复核任务处理中",
    context: [
      { label: "文件名", value: state.wordReport.filename },
      { label: "复核范围", value: scope === "risk_point" ? `风险点${formatWordRiskPointLabel(point)}` : "全面复核" },
      { label: "全文长度", value: `${state.wordReport.text_length} 字` },
      { label: "风险点数量", value: `${state.wordReport.risk_points.length} 个` },
    ],
    estimatedTime: scope === "risk_point" ? "通常 20-60 秒" : "按风险点数量递增",
    stages: ["确认 Word 结构", "提交复核任务", "逐项分析风险点完整性", "生成复核意见"],
    note: "复核依据当前 Word 提取文本和结构化风险点进行，不重新判定企业风险；关键字检查按内置规则确定性执行。",
    stageDurationMs: 9000,
    abort: {
      label: "中止本次复核",
      onClick: () => abortActiveRequest("wordReview", "wordReviewLoadingPanel", "Word 报告复核任务已中止"),
    },
  });
  try {
    if (scope === "full") {
      const pointRecords = [];
      for (const riskPoint of state.wordReport.risk_points) {
        const pointContext = createWordReviewContext("risk_point", riskPoint);
        const data = await fetchJson("/api/report/word/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...state.wordReport,
            review_scope: "risk_point",
            selected_risk_point_index: riskPoint.index,
          }),
          signal: reviewController.signal,
        });
        const pointRecord = createWordReviewRecord(data, pointContext);
        saveWordReviewRecord(pointRecord);
        pointRecords.push(pointRecord);
      }
      clearLoadingPanel("wordReviewLoadingPanel");
      const fullRecord = createWordBatchReviewRecord(pointRecords, reviewContext);
      saveWordReviewRecord(fullRecord);
      setCurrentWordReviewRecord(fullRecord);
      renderWordBatchReviewResult(fullRecord);
      saveWordDemoCache();
    } else {
      const data = await fetchJson("/api/report/word/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...state.wordReport,
          review_scope: scope,
          selected_risk_point_index: point.index,
        }),
        signal: reviewController.signal,
      });
      clearLoadingPanel("wordReviewLoadingPanel");
      const record = createWordReviewRecord(data, reviewContext);
      saveWordReviewRecord(record);
      setCurrentWordReviewRecord(record);
      renderReviewResult(data, {
        containerId: "wordReviewResult",
        copyButtonId: "copyWordReviewBtn",
        downloadButtonId: "downloadWordReviewBtn",
        textTarget: "word",
        sourceRenderer: appendWordReportInfo,
        objectTitle: formatWordReviewObjectTitle(data, reviewContext),
        plainTextFormatter: () => record.plain_text,
        riskLabel: `风险点${formatWordRiskPointLabel(point)}：${point.title}`,
      });
      saveWordDemoCache();
    }
    renderWordRiskPointList();
    renderSelectedWordRiskPoint();
    renderWordReviewRecordPanels();
    showToast(scope === "risk_point" ? "当前风险点复核结果已保存。" : "全体风险点复核结果已保存。", "success");
  } catch (error) {
    if (error.name === "AbortError") return;
    showLoadingError("wordReviewLoadingPanel", "Word 报告复核任务未完成", error.message);
    showToast(error.message);
  } finally {
    clearActiveRequest("wordReview");
    setLoading(button, spinner, false);
  }
}

async function handleReview() {
  if (!state.selectedReport) {
    showToast("请先选择报告。");
    return;
  }
  setLoading($("reviewBtn"), $("reviewSpinner"), true);
  $("reviewResult").classList.add("d-none");
  $("copyReviewBtn").classList.add("d-none");
  $("downloadReviewBtn").classList.add("d-none");
  const reviewController = new AbortController();
  state.activeRequests.review = reviewController;
  startLoadingPanel("reviewLoadingPanel", {
    title: "报告复核任务处理中",
    context: [
      { label: "复核对象", value: getTaxpayerName(state.selectedReport) },
      { label: "报告编号", value: getReportId(state.selectedReport) },
      { label: "人工认定结果", value: getManualConclusion(state.selectedReport) },
      { label: "情况说明字数", value: `${state.selectedReport.text_length} 字` },
    ],
    estimatedTime: "通常 20-60 秒",
    stages: ["确认报告正文", "提交复核任务", "分析结构与完整性", "生成复核意见"],
    note: "复核依据当前情况说明及上传表字段进行，不重新判定企业风险；关键字检查按内置规则确定性执行。",
    stageDurationMs: 7000,
    abort: {
      label: "中止本次复核",
      onClick: () => abortActiveRequest("review", "reviewLoadingPanel", "报告复核任务已中止"),
    },
  });
  try {
    const data = await fetchJson("/api/report/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report_text: state.selectedReport.full_text,
        record_id: state.selectedReport.record_id,
        taxpayer_name: state.selectedReport.taxpayer_name,
        task_name: state.selectedReport.task_name,
        risk_brief: state.selectedReport.risk_brief,
        manual_conclusion: state.selectedReport.manual_conclusion,
        rectification_status: state.selectedReport.rectification_status,
      }),
      signal: reviewController.signal,
    });
    clearLoadingPanel("reviewLoadingPanel");
    state.reviewCache[getReportKey(state.selectedReport)] = data;
    renderReviewResult(data);
    $("reviewBtnLabel").textContent = "重新复核";
    saveExcelDemoCache();
  } catch (error) {
    if (error.name === "AbortError") return;
    showLoadingError("reviewLoadingPanel", "报告复核任务未完成", error.message);
    showToast(error.message);
  } finally {
    clearActiveRequest("review");
    setLoading($("reviewBtn"), $("reviewSpinner"), false);
  }
}

async function copyReviewResult() {
  if (!state.lastReviewText) {
    showToast("暂无可复制的复核结果。");
    return;
  }
  try {
    await navigator.clipboard.writeText(state.lastReviewText);
    showToast("复核结果已复制。", "success");
  } catch (error) {
    showToast("复制失败，请手动选择结果文本复制。");
  }
}

function downloadReviewResult() {
  if (!state.lastReviewText) {
    showToast("暂无可保存的复核结果。");
    return;
  }
  const report = state.selectedReport;
  const taxpayerName = report ? getTaxpayerName(report) : "报告";
  const reportId = report ? getReportId(report) : "复核结果";
  const blob = new Blob([state.lastReviewText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(taxpayerName)}_${sanitizeFilename(reportId)}_报告复核结果.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyWordReviewResult() {
  if (!state.lastWordReviewText) {
    showToast("暂无可复制的 Word 复核结果。");
    return;
  }
  try {
    await navigator.clipboard.writeText(state.lastWordReviewText);
    showToast("Word 复核结果已复制。", "success");
  } catch (error) {
    showToast("复制失败，请手动选择结果文本复制。");
  }
}

function downloadWordReviewResult() {
  if (!state.lastWordReviewText) {
    showToast("暂无可下载的 Word 复核报告。");
    return;
  }
  const context = state.lastWordReviewContext;
  const baseName = state.wordReport && state.wordReport.filename ? state.wordReport.filename.replace(/\.[^.]+$/, "") : "Word完整报告";
  const scopeName = context && context.risk_point ? `风险点${formatWordRiskPointLabel(context.risk_point)}` : "全体风险点复核";
  const blob = new Blob([state.lastWordReviewText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(baseName)}_${sanitizeFilename(scopeName)}_AI复核报告.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetUnifiedReportUpload() {
  resetExcelReportState();
  resetWordReport();
  if ($("reportFileInput")) $("reportFileInput").value = "";
  if ($("reportUnifiedFileName")) $("reportUnifiedFileName").textContent = "未选择文件";
  if ($("reportExcelPanel")) $("reportExcelPanel").classList.add("d-none");
  if ($("reportWordPanel")) $("reportWordPanel").classList.add("d-none");
  if ($("reportUnifiedResetBtn")) $("reportUnifiedResetBtn").classList.add("d-none");
  clearLoadingPanel("reviewLoadingPanel");
  clearLoadingPanel("wordReviewLoadingPanel");
  clearReportDemoCache();
}

async function handleUnifiedReportUpload() {
  const input = $("reportFileInput");
  const file = input && input.files[0];
  if (!file) {
    showToast("请先选择待复核报告文件。");
    return;
  }
  $("reportUnifiedFileName").textContent = file.name;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xlsx")) {
    clearReportDemoCache();
    resetExcelReportState();
    resetWordReport();
    await parseExcelReportFile(file, $("reportFileSelectBtn"), $("reportFileSpinner"));
  } else if (lowerName.endsWith(".docx")) {
    clearReportDemoCache();
    resetExcelReportState();
    resetWordReport();
    await parseWordReportFile(file, $("reportFileSelectBtn"), $("reportFileSpinner"));
  } else if (lowerName.endsWith(".doc")) {
    showToast("暂不支持旧版 .doc 格式，请另存为 .docx 后上传。");
  } else {
    showToast("文件格式不支持。请上传 .xlsx 报告清单或 .docx Word 完整报告。");
  }
}

function bindIfExists(id, eventName, handler) {
  const element = $(id);
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

function restoreSmartDemoCache() {
  if (!$("smartRiskPanel")) return;
  const smart = readDemoCache().smart;
  const riskClues = smart.riskClues || [];
  const records = smart.companyAdviceRecords || {};
  if (!riskClues.length && !Object.keys(records).length) return;

  state.riskClues = riskClues;
  state.companyAdviceRecords = records;
  state.selectedRiskCompany = null;
  state.selectedRiskAdviceContext = null;
  const companyCount = Object.keys(groupRiskCluesByCompany()).length;
  $("riskClueSummary").textContent = `已恢复 ${riskClues.length} 条风险点，涉及 ${companyCount} 户企业`;
  $("smartFreePanel").classList.add("d-none");
  $("smartRiskPanel").classList.remove("d-none");
  $("riskClueWorkspace").classList.remove("d-none");
  $("riskCompanyIndexPanel").classList.remove("d-none");
  $("riskCompanyDetailPanel").classList.add("d-none");
  $("selectedRiskCompanyPanel").classList.add("d-none");
  $("riskClueResetBtn").classList.remove("d-none");
  renderRiskClueList();
}

function restoreExcelDemoCache(reportCache) {
  const excel = reportCache.excel || {};
  if (!excel.reports || !excel.reports.length) return false;
  state.reportMode = "excel";
  state.reports = excel.reports;
  state.reviewCache = excel.reviewCache || {};
  state.selectedReport = null;
  state.lastReviewText = "";
  renderReportList(state.reports);
  $("reportExcelPanel").classList.remove("d-none");
  $("reportWordPanel").classList.add("d-none");
  $("reportUnifiedResetBtn").classList.remove("d-none");
  $("selectStage").classList.remove("d-none");
  $("reviewStage").classList.add("d-none");

  if (excel.selectedReportKey && state.reviewCache[excel.selectedReportKey]) {
    const report = state.reports.find((item) => getReportKey(item) === excel.selectedReportKey);
    if (report) {
      state.selectedReport = report;
      $("selectedReportTitle").textContent = `情况说明预览：${getTaxpayerName(report)}`;
      renderSelectedReportMeta(report);
      $("reportPreview").textContent = report.full_text;
      $("reviewBtnLabel").textContent = "重新复核";
      $("selectStage").classList.add("d-none");
      $("reviewStage").classList.remove("d-none");
      renderReviewResult(state.reviewCache[excel.selectedReportKey], { fromCache: true });
    }
  }
  return true;
}

function restoreWordDemoCache(reportCache) {
  const word = reportCache.word || {};
  if (!word.wordReport) return false;
  renderWordReportParsed(word.wordReport);
  state.wordReviewRecords = word.wordReviewRecords || { full: null, riskPoints: {} };
  state.selectedWordRiskPointIndex = word.selectedWordRiskPointIndex;
  renderWordRiskPointList();
  renderSelectedWordRiskPoint();
  renderWordReviewRecordPanels();

  const fullRecord = getWordReviewRecord("full");
  if (fullRecord) {
    setCurrentWordReviewRecord(fullRecord);
    renderWordBatchReviewResult(fullRecord);
  } else {
    const point = selectedWordRiskPoint();
    const pointRecord = point ? getWordReviewRecord("risk_point", point) : null;
    if (pointRecord) {
      setCurrentWordReviewRecord(pointRecord);
      renderReviewResult(pointRecord.data, {
        containerId: "wordReviewResult",
        copyButtonId: "copyWordReviewBtn",
        downloadButtonId: "downloadWordReviewBtn",
        textTarget: "word",
        sourceRenderer: appendWordReportInfo,
        objectTitle: formatWordReviewObjectTitle(pointRecord.data, pointRecord.context),
        plainTextFormatter: () => pointRecord.plain_text,
        riskLabel: point ? `风险点${formatWordRiskPointLabel(point)}：${point.title}` : null,
      });
    }
  }
  return true;
}

function restoreReportDemoCache() {
  if (!$("reportExcelPanel")) return;
  const reportCache = readDemoCache().report;
  if (reportCache.mode === "word" && restoreWordDemoCache(reportCache)) return;
  if (reportCache.mode === "excel" && restoreExcelDemoCache(reportCache)) return;
  restoreWordDemoCache(reportCache) || restoreExcelDemoCache(reportCache);
}

function bindEvents() {
  bindIfExists("chatSubmitBtn", "click", handleChatSubmit);
  bindIfExists("chatClearBtn", "click", resetChat);
  bindIfExists("chatClearHistoryBtn", "click", clearChatHistory);
  bindIfExists("riskClueParseBtn", "click", () => $("riskClueInput").click());
  bindIfExists("riskClueResetBtn", "click", resetRiskClues);
  bindIfExists("riskClueSearchBtn", "click", renderRiskClueList);
  bindIfExists("riskClueSearchInput", "keydown", (event) => {
    if (event.key === "Enter") renderRiskClueList();
  });
  bindIfExists("riskClueSearchInput", "input", renderRiskClueList);
  bindIfExists("riskCompanyBackBtn", "click", backToRiskCompanyIndex);
  bindIfExists("riskCompanyAllContextBtn", "click", () => selectRiskAdviceContext("company"));
  bindIfExists("companyRiskSearchBtn", "click", renderCompanyRiskClueList);
  bindIfExists("companyRiskSearchInput", "keydown", (event) => {
    if (event.key === "Enter") renderCompanyRiskClueList();
  });
  bindIfExists("companyRiskSearchInput", "input", renderCompanyRiskClueList);
  bindIfExists("riskAdviceBtn", "click", handleRiskAdviceSubmit);
  bindIfExists("riskAdviceClearBtn", "click", clearRiskAdviceContext);
  bindIfExists("riskClueInput", "change", () => {
    const file = $("riskClueInput").files[0];
    $("riskClueFileName").textContent = file ? file.name : "未选择文件";
    if (file) handleParseRiskClues();
  });
  bindIfExists("policySearchBtn", "click", () => handleKnowledgeSearch("policies"));
  bindIfExists("caseSearchBtn", "click", () => handleKnowledgeSearch("cases"));
  bindIfExists("policySearchInput", "keydown", (event) => {
    if (event.key === "Enter") handleKnowledgeSearch("policies");
  });
  bindIfExists("caseSearchInput", "keydown", (event) => {
    if (event.key === "Enter") handleKnowledgeSearch("cases");
  });
  bindIfExists("reportFileSelectBtn", "click", () => $("reportFileInput").click());
  bindIfExists("reportFileInput", "change", handleUnifiedReportUpload);
  bindIfExists("reportUnifiedResetBtn", "click", resetUnifiedReportUpload);
  bindIfExists("wordRiskSearchBtn", "click", renderWordRiskPointList);
  bindIfExists("wordRiskSearchInput", "keydown", (event) => {
    if (event.key === "Enter") renderWordRiskPointList();
  });
  bindIfExists("wordRiskSearchInput", "input", renderWordRiskPointList);
  bindIfExists("wordReviewAllBtn", "click", () => handleWordReview("full"));
  bindIfExists("wordReviewPointBtn", "click", () => handleWordReview("risk_point"));
  bindIfExists("copyWordReviewBtn", "click", copyWordReviewResult);
  bindIfExists("downloadWordReviewBtn", "click", downloadWordReviewResult);
  bindIfExists("resetUploadBtn", "click", resetUpload);
  bindIfExists("backToListBtn", "click", backToList);
  bindIfExists("reviewBtn", "click", handleReview);
  bindIfExists("copyReviewBtn", "click", copyReviewResult);
  bindIfExists("downloadReviewBtn", "click", downloadReviewResult);
}

function initializePage() {
  restoreSmartDemoCache();
  restoreReportDemoCache();
  if ($("policySearchResult")) {
    handleKnowledgeSearch("policies", 3000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  initializePage();
});
