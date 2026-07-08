const state = {
  reports: [],
  selectedReport: null,
  lastReviewText: "",
  loadingTasks: {},
  chatHistory: [],
  reviewCache: {},
  activeRequests: {},
};

const $ = (id) => document.getElementById(id);

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
  button.disabled = isLoading;
  spinner.classList.toggle("d-none", !isLoading);
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

function renderChatResult(data) {
  const container = $("chatResult");
  container.innerHTML = "";
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
    return;
  }

  const list = document.createElement("div");
  list.className = "knowledge-list";
  data.results.forEach((item) => {
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

async function handleKnowledgeSearch(category) {
  const config = knowledgeSearchConfig[category];
  const query = $(config.inputId).value.trim();
  setLoading($(config.buttonId), $(config.spinnerId), true);
  try {
    const data = await fetchJson(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 20 }),
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
      { label: "任务类型", value: "风险核查辅助研判" },
      { label: "输入长度", value: `${question.length} 字` },
    ],
    estimatedTime: "通常 10-40 秒",
    stages: ["提交问题", "调用大模型生成辅助研判", "整理结构化结果", "等待结果返回"],
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
      main: formatShortText(taskName, 34),
      meta: "完整任务名称见详情",
    };
  }
  return {
    main: `${match[1]} · ${match[2]} · ${match[6]}`,
    meta: `${match[4]} · 管理条线${match[3]} / 市局${match[5]}`,
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
    appendTextElement(tr, "td", String(report.text_length));
    const statusTd = document.createElement("td");
    const cached = Boolean(state.reviewCache[getReportKey(report)]);
    appendTextElement(statusTd, "span", cached ? "已复核" : "待复核", cached ? "status-badge done" : "status-badge pending");
    tr.appendChild(statusTd);
    const actionTd = document.createElement("td");
    const button = document.createElement("button");
    button.className = "btn btn-sm btn-outline-primary";
    button.textContent = "选择";
    button.addEventListener("click", () => selectReport(index));
    actionTd.appendChild(button);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
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

async function handleParseReport() {
  const file = $("excelInput").files[0];
  if (!file) {
    showToast("请先选择 .xlsx 文件。");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  setLoading($("parseBtn"), $("parseSpinner"), true);
  try {
    const data = await fetchJson("/api/report/parse", {
      method: "POST",
      body: formData,
    });
    state.reports = data.reports || [];
    state.selectedReport = null;
    state.lastReviewText = "";
    state.reviewCache = {};
    renderReportList(state.reports);
    $("uploadStage").classList.add("d-none");
    $("selectStage").classList.remove("d-none");
    $("reviewStage").classList.add("d-none");
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading($("parseBtn"), $("parseSpinner"), false);
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
  const cachedResult = state.reviewCache[getReportKey(state.selectedReport)];
  $("reviewBtnLabel").textContent = cachedResult ? "重新复核" : "开始复核";
  $("selectStage").classList.add("d-none");
  $("reviewStage").classList.remove("d-none");
  if (cachedResult) {
    renderReviewResult(cachedResult, { fromCache: true });
  }
}

function resetUpload() {
  if (state.activeRequests.review) {
    state.activeRequests.review.abort();
    clearActiveRequest("review");
  }
  state.reports = [];
  state.selectedReport = null;
  state.lastReviewText = "";
  state.reviewCache = {};
  $("excelInput").value = "";
  $("selectedFileName").textContent = "未选择文件";
  $("reportListBody").innerHTML = "";
  $("selectedReportMeta").innerHTML = "";
  clearLoadingPanel("reviewLoadingPanel");
  $("uploadStage").classList.remove("d-none");
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

function appendReviewTopSummary(parent, data) {
  const panel = document.createElement("section");
  panel.className = "review-summary-panel";
  appendTextElement(panel, "h3", "复核结论摘要");
  appendTextElement(panel, "p", data.final_review_opinion);
  if (data.manual_conclusion_support_check) {
    appendTextElement(
      panel,
      "p",
      `人工认定结果支撑状态：${data.manual_conclusion_support_check.support_status}`,
      "summary-status",
    );
  }
  parent.appendChild(panel);
}

function renderReviewResult(data, options = {}) {
  const container = $("reviewResult");
  container.innerHTML = "";

  if (options.fromCache) {
    appendTextElement(container, "div", "已展示本次页面会话中生成的复核结果。如需重新调用模型，请点击“重新复核”。", "cache-notice");
  }

  appendOriginalReportInfo(container, state.selectedReport);
  appendTextElement(container, "div", `报告分析对象：${data.report_object}`, "object-title");
  appendReviewTopSummary(container, data);

  appendSection(container, "一、报告摘要");
  appendTextElement(container, "p", data.report_summary);

  appendSection(container, "二、报告结构分析");
  appendTable(
    container,
    ["标题规范表述", "实际表述", "语义匹配情况"],
    data.structure_analysis.rows || [],
    ["standard_title", "actual_expression", "match_status"],
  );
  appendTextElement(container, "p", `说明：${data.structure_analysis.note}`);

  appendSection(container, "三、关键字检查");
  appendTextElement(container, "p", data.keyword_check.content);

  appendSection(container, "四、应对完整性检查");
  appendTable(
    container,
    ["下发疑点", "报告中风险核实情况", "是否覆盖", "数据支撑"],
    data.response_completeness_check.rows || [],
    ["assigned_issue", "verification_status", "coverage_status", "data_support"],
  );
  appendTextElement(container, "p", `说明：${data.response_completeness_check.note}`);
  appendTextElement(container, "p", `结论：${data.response_completeness_check.conclusion}`);

  appendSection(container, "五、应对结论检查");
  appendTable(
    container,
    ["风险点", "处理措施", "语义匹配情况"],
    data.response_conclusion_check.rows || [],
    ["risk_point", "treatment_measure", "match_status"],
  );
  appendTextElement(container, "p", `说明：${data.response_conclusion_check.note}`);
  appendTextElement(container, "p", `提示：${data.response_conclusion_check.tip}`);
  appendTextElement(container, "p", `结论：${data.response_conclusion_check.conclusion}`);

  appendSection(container, "六、人工认定结果支撑性检查");
  appendTable(
    container,
    ["人工认定结果", "支撑状态", "支撑依据", "缺口分析", "结论"],
    data.manual_conclusion_support_check ? [data.manual_conclusion_support_check] : [],
    ["manual_conclusion", "support_status", "evidence_summary", "gap_analysis", "conclusion"],
  );

  appendSection(container, "七、应对质效评估");
  appendTextElement(container, "p", `总体评价：${data.quality_evaluation.overall_level}`);
  appendBullets(container, "已体现的优点", data.quality_evaluation.strengths);
  appendBullets(container, "待完善问题", data.quality_evaluation.deficiencies);
  appendBullets(container, "修改建议", data.quality_evaluation.improvement_suggestions);

  appendSection(container, "八、复核情况总结");
  appendBullets(container, "具体情况", data.review_summary.specific_situation);
  appendTextElement(container, "p", `分析结论：${data.review_summary.analysis_conclusion}`);

  appendSection(container, "最终复核意见");
  appendTextElement(container, "p", data.final_review_opinion);

  state.lastReviewText = formatReviewPlainText(data);
  container.classList.remove("d-none");
  $("copyReviewBtn").classList.remove("d-none");
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

function formatReviewPlainText(data) {
  const lines = [];
  const originalReportText = formatOriginalReportPlainText(state.selectedReport);
  const supportStatus = data.manual_conclusion_support_check
    ? data.manual_conclusion_support_check.support_status
    : "未返回";
  if (originalReportText) {
    lines.push(originalReportText, "");
  }
  lines.push(
    `报告分析对象：${data.report_object}`,
    "",
    "复核结论摘要",
    data.final_review_opinion,
    `人工认定结果支撑状态：${supportStatus}`,
    "",
    "一、报告摘要",
    data.report_summary,
    "",
    "二、报告结构分析",
    tableToText(["标题规范表述", "实际表述", "语义匹配情况"], data.structure_analysis.rows || [], ["standard_title", "actual_expression", "match_status"]),
    `说明：${data.structure_analysis.note}`,
    "",
    "三、关键字检查",
    data.keyword_check.content,
    "",
    "四、应对完整性检查",
    tableToText(["下发疑点", "报告中风险核实情况", "是否覆盖", "数据支撑"], data.response_completeness_check.rows || [], ["assigned_issue", "verification_status", "coverage_status", "data_support"]),
    `说明：${data.response_completeness_check.note}`,
    `结论：${data.response_completeness_check.conclusion}`,
    "",
    "五、应对结论检查",
    tableToText(["风险点", "处理措施", "语义匹配情况"], data.response_conclusion_check.rows || [], ["risk_point", "treatment_measure", "match_status"]),
    `说明：${data.response_conclusion_check.note}`,
    `提示：${data.response_conclusion_check.tip}`,
    `结论：${data.response_conclusion_check.conclusion}`,
    "",
    "六、人工认定结果支撑性检查",
    tableToText(["人工认定结果", "支撑状态", "支撑依据", "缺口分析", "结论"], data.manual_conclusion_support_check ? [data.manual_conclusion_support_check] : [], ["manual_conclusion", "support_status", "evidence_summary", "gap_analysis", "conclusion"]),
    "",
    "七、应对质效评估",
    `- 总体评价：${data.quality_evaluation.overall_level}`,
    "- 已体现的优点",
    listToText(data.quality_evaluation.strengths),
    "- 待完善问题",
    listToText(data.quality_evaluation.deficiencies),
    "- 修改建议",
    listToText(data.quality_evaluation.improvement_suggestions),
    "",
    "八、复核情况总结",
    "具体情况",
    listToText(data.review_summary.specific_situation),
    `分析结论：${data.review_summary.analysis_conclusion}`,
    "",
    "最终复核意见",
    data.final_review_opinion,
  );
  return lines.join("\n");
}

async function handleReview() {
  if (!state.selectedReport) {
    showToast("请先选择报告。");
    return;
  }
  setLoading($("reviewBtn"), $("reviewSpinner"), true);
  $("reviewResult").classList.add("d-none");
  $("copyReviewBtn").classList.add("d-none");
  const reviewController = new AbortController();
  state.activeRequests.review = reviewController;
  startLoadingPanel("reviewLoadingPanel", {
    title: "报告复核任务处理中",
    context: [
      { label: "复核对象", value: getTaxpayerName(state.selectedReport) },
      { label: "报告编号", value: getReportId(state.selectedReport) },
      { label: "人工认定结果", value: getManualConclusion(state.selectedReport) },
      { label: "情况说明长度", value: `${state.selectedReport.text_length} 字` },
    ],
    estimatedTime: "通常 20-60 秒",
    stages: ["确认报告正文", "提交复核任务", "分析结构与完整性", "生成复核意见"],
    note: "复核依据当前情况说明及上传表中的疑点、人工认定结果等字段进行，不重新判定企业风险，不自动检索政策法规、历史案例、企业外部数据或关键字规则库。",
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

function bindIfExists(id, eventName, handler) {
  const element = $(id);
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

function setMenuOpen(isOpen) {
  document.body.classList.toggle("menu-open", isOpen);
  const button = $("menuToggleBtn");
  if (button) {
    button.setAttribute("aria-expanded", String(isOpen));
  }
}

function bindMenuDrawer() {
  bindIfExists("menuToggleBtn", "click", () => setMenuOpen(true));
  bindIfExists("menuCloseBtn", "click", () => setMenuOpen(false));
  bindIfExists("menuBackdrop", "click", () => setMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuOpen(false);
    }
  });
}

function bindEvents() {
  bindMenuDrawer();
  bindIfExists("chatSubmitBtn", "click", handleChatSubmit);
  bindIfExists("chatClearBtn", "click", resetChat);
  bindIfExists("chatClearHistoryBtn", "click", clearChatHistory);
  bindIfExists("policySearchBtn", "click", () => handleKnowledgeSearch("policies"));
  bindIfExists("caseSearchBtn", "click", () => handleKnowledgeSearch("cases"));
  bindIfExists("policySearchInput", "keydown", (event) => {
    if (event.key === "Enter") handleKnowledgeSearch("policies");
  });
  bindIfExists("caseSearchInput", "keydown", (event) => {
    if (event.key === "Enter") handleKnowledgeSearch("cases");
  });
  bindIfExists("parseBtn", "click", handleParseReport);
  bindIfExists("resetUploadBtn", "click", resetUpload);
  bindIfExists("backToListBtn", "click", backToList);
  bindIfExists("reviewBtn", "click", handleReview);
  bindIfExists("copyReviewBtn", "click", copyReviewResult);
  bindIfExists("excelInput", "change", () => {
    const file = $("excelInput").files[0];
    $("selectedFileName").textContent = file ? file.name : "未选择文件";
  });
}

document.addEventListener("DOMContentLoaded", bindEvents);
