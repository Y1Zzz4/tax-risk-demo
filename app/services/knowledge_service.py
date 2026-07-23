from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import HTTPException

from app.schemas import KnowledgeSearchItem, KnowledgeSearchResponse


KnowledgeCategory = Literal["policies", "cases"]

KNOWLEDGE_DIR = Path("data/knowledge")
KNOWLEDGE_FILES: dict[KnowledgeCategory, tuple[str, tuple[str, ...]]] = {
    "policies": ("政策法规", ("policies.xlsx",)),
    "cases": ("历史案例", ("cases.xlsx", "case.xlsx")),
}
CASE_TEXT_DIR = KNOWLEDGE_DIR / "case_text"

TITLE_ALIASES: dict[KnowledgeCategory, tuple[str, ...]] = {
    "policies": ("标题", "政策标题", "法规名称", "文件名称", "名称", "title"),
    "cases": ("案例名称", "案例标题", "标题", "企业名称", "纳税人名称", "title"),
}

SUBTITLE_ALIASES: dict[KnowledgeCategory, tuple[str, ...]] = {
    "policies": ("发文字号", "文号", "时效性", "发文时间", "发文机关", "发布机关", "发布日期", "适用范围"),
    "cases": ("风险类型", "行业", "税种", "处理结果", "案例来源"),
}

CONTENT_ALIASES: dict[KnowledgeCategory, tuple[str, ...]] = {
    "policies": ("内容", "正文", "摘要", "条款", "政策要点", "适用口径"),
    "cases": ("基本案情", "裁判理由", "裁判结果", "案情", "案例内容", "风险描述", "核查情况", "处理结果", "启示"),
}

POLICY_FORWARD_FILL_COLUMNS = ("类型",)
CASE_FORWARD_FILL_COLUMNS = ("涉税争议一级分类", "涉税争议二级分类")
_KNOWLEDGE_CACHE: dict[KnowledgeCategory, tuple[float, pd.DataFrame]] = {}
_CASE_TEXT_CACHE: dict[Path, tuple[float, str]] = {}


def _normalize_column_name(value: object) -> str:
    return str(value).strip().lower()


def _stringify_value(value: object) -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    return text if text and text.lower() != "nan" else ""


def _pick_field(fields: dict[str, str], aliases: tuple[str, ...]) -> str | None:
    normalized = {_normalize_column_name(key): value for key, value in fields.items()}
    for alias in aliases:
        value = normalized.get(_normalize_column_name(alias))
        if value:
            return value
    return None


def _preview_text(text: str, limit: int = 180) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit]}..."


def _resolve_source_path(category: KnowledgeCategory) -> tuple[str, Path]:
    category_name, filenames = KNOWLEDGE_FILES[category]
    for filename in filenames:
        path = KNOWLEDGE_DIR / filename
        if path.exists():
            return category_name, path
    return category_name, KNOWLEDGE_DIR / filenames[0]


def _row_to_fields(row: pd.Series) -> dict[str, str]:
    fields: dict[str, str] = {}
    for column, value in row.items():
        text = _stringify_value(value)
        if text:
            fields[str(column).strip()] = text
    return fields


def _format_policy_subtitle(fields: dict[str, str]) -> str | None:
    parts = [
        fields.get("发文字号"),
        fields.get("时效性"),
        fields.get("发文时间"),
    ]
    text = " · ".join(part for part in parts if part)
    if text:
        return text
    return _pick_field(fields, SUBTITLE_ALIASES["policies"])


def _read_text_file(path: Path) -> str:
    if not path.exists() or not path.is_file():
        return ""
    cached = _CASE_TEXT_CACHE.get(path)
    mtime = path.stat().st_mtime
    if cached and cached[0] == mtime:
        return cached[1]
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            text = data.decode(encoding).strip()
            _CASE_TEXT_CACHE[path] = (mtime, text)
            return text
        except UnicodeDecodeError:
            continue
    text = data.decode("utf-8", errors="replace").strip()
    _CASE_TEXT_CACHE[path] = (mtime, text)
    return text


def _case_text_path(fields: dict[str, str]) -> Path | None:
    raw_file = fields.get("原文文件") or fields.get("全文文件") or fields.get("文件名")
    case_id = fields.get("案例ID") or fields.get("案例编号") or fields.get("编号")
    filename = ""
    if raw_file:
        filename = Path(raw_file.replace("\\", "/")).name
    elif case_id:
        filename = f"{case_id}.txt"
    if not filename:
        return None
    return CASE_TEXT_DIR / filename


def _case_full_text(fields: dict[str, str]) -> str:
    path = _case_text_path(fields)
    return _read_text_file(path) if path else ""


def _format_case_subtitle(fields: dict[str, str]) -> str | None:
    parts = [
        fields.get("涉税争议一级分类"),
        fields.get("涉税争议二级分类"),
        fields.get("案号"),
        fields.get("审理法院"),
        fields.get("裁判日期"),
    ]
    text = " · ".join(part for part in parts if part)
    if text:
        return text
    return _pick_field(fields, SUBTITLE_ALIASES["cases"])


def _build_item(category: KnowledgeCategory, row_index: int, fields: dict[str, str], full_text: str = "") -> KnowledgeSearchItem:
    title = _pick_field(fields, TITLE_ALIASES[category]) or f"{KNOWLEDGE_FILES[category][0]}记录 {row_index}"
    subtitle = _format_policy_subtitle(fields) if category == "policies" else _pick_field(fields, SUBTITLE_ALIASES[category])
    if category == "cases":
        subtitle = _format_case_subtitle(fields)
    content = _pick_field(fields, CONTENT_ALIASES[category]) or "；".join(fields.values())
    if category == "cases" and not content and full_text:
        content = full_text
    return KnowledgeSearchItem(
        row_index=row_index,
        title=title,
        subtitle=subtitle,
        content_preview=_preview_text(content),
        full_text=full_text or None,
        fields=fields,
    )


def _load_knowledge_dataframe(category: KnowledgeCategory, source_path: Path, category_name: str) -> pd.DataFrame:
    mtime = source_path.stat().st_mtime
    cached = _KNOWLEDGE_CACHE.get(category)
    if cached and cached[0] == mtime:
        return cached[1]

    try:
        if category == "cases":
            raw = pd.read_excel(source_path, sheet_name=0, engine="openpyxl", dtype=object, header=None, nrows=8)
            header_row = 0
            for index, row in raw.iterrows():
                values = {_stringify_value(value) for value in row.tolist()}
                if {"案例ID", "案例名称"}.issubset(values):
                    header_row = int(index)
                    break
            df = pd.read_excel(source_path, sheet_name=0, engine="openpyxl", dtype=object, header=header_row)
            df.attrs["row_offset"] = header_row + 2
        else:
            df = pd.read_excel(source_path, sheet_name=0, engine="openpyxl", dtype=object)
            df.attrs["row_offset"] = 2
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{category_name}知识库 Excel 解析失败：{exc}") from exc

    df = df.dropna(how="all")

    forward_fill_columns = POLICY_FORWARD_FILL_COLUMNS if category == "policies" else CASE_FORWARD_FILL_COLUMNS
    for column in forward_fill_columns:
        if column in df.columns:
            df[column] = df[column].ffill()

    _KNOWLEDGE_CACHE[category] = (mtime, df)
    return df


def search_knowledge(category: KnowledgeCategory, query: str, limit: int) -> KnowledgeSearchResponse:
    if category not in KNOWLEDGE_FILES:
        raise HTTPException(status_code=404, detail="未知知识库类型。")

    category_name, source_path = _resolve_source_path(category)
    if not source_path.exists():
        expected_files = " 或 ".join(str(KNOWLEDGE_DIR / filename) for filename in KNOWLEDGE_FILES[category][1])
        return KnowledgeSearchResponse(
            category=category,
            category_name=category_name,
            source_file=str(source_path),
            exists=False,
            total_rows=0,
            matched_count=0,
            results=[],
            message=f"未找到{category_name}知识库文件，请将 Excel 放到 {expected_files}。",
        )

    df = _load_knowledge_dataframe(category, source_path, category_name)
    total_rows = len(df)
    tokens = [part.lower() for part in query.strip().split() if part.strip()]
    row_offset = int(df.attrs.get("row_offset", 2))
    matched: list[tuple[int, int, dict[str, str], str]] = []

    for index, row in df.iterrows():
        fields = _row_to_fields(row)
        if not fields:
            continue
        full_text = _case_full_text(fields) if category == "cases" else ""
        haystack = " ".join([*fields.values(), full_text]).lower()
        if tokens:
            if not all(token in haystack for token in tokens):
                continue
            score = sum(haystack.count(token) for token in tokens)
        else:
            score = 0
        matched.append((score, int(index) + row_offset, fields, full_text))

    if tokens:
        matched.sort(key=lambda item: (-item[0], item[1]))

    results = [_build_item(category, row_index, fields, full_text) for _, row_index, fields, full_text in matched[:limit]]
    if tokens:
        message = f"已在{category_name}知识库中检索到 {len(matched)} 条匹配记录。"
    else:
        message = f"未输入关键词，展示{category_name}知识库前 {len(results)} 条记录。"

    return KnowledgeSearchResponse(
        category=category,
        category_name=category_name,
        source_file=str(source_path),
        exists=True,
        total_rows=total_rows,
        matched_count=len(matched),
        results=results,
        message=message,
    )
