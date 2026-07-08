from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import HTTPException

from app.schemas import KnowledgeSearchItem, KnowledgeSearchResponse


KnowledgeCategory = Literal["policies", "cases"]

KNOWLEDGE_DIR = Path("data/knowledge")
KNOWLEDGE_FILES: dict[KnowledgeCategory, tuple[str, str]] = {
    "policies": ("政策法规", "policies.xlsx"),
    "cases": ("历史案例", "cases.xlsx"),
}

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
    "cases": ("案情", "案例内容", "风险描述", "核查情况", "处理结果", "启示"),
}

POLICY_FORWARD_FILL_COLUMNS = ("类型",)


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


def _build_item(category: KnowledgeCategory, row_index: int, fields: dict[str, str]) -> KnowledgeSearchItem:
    title = _pick_field(fields, TITLE_ALIASES[category]) or f"{KNOWLEDGE_FILES[category][0]}记录 {row_index}"
    subtitle = _format_policy_subtitle(fields) if category == "policies" else _pick_field(fields, SUBTITLE_ALIASES[category])
    content = _pick_field(fields, CONTENT_ALIASES[category]) or "；".join(fields.values())
    return KnowledgeSearchItem(
        row_index=row_index,
        title=title,
        subtitle=subtitle,
        content_preview=_preview_text(content),
        fields=fields,
    )


def search_knowledge(category: KnowledgeCategory, query: str, limit: int) -> KnowledgeSearchResponse:
    if category not in KNOWLEDGE_FILES:
        raise HTTPException(status_code=404, detail="未知知识库类型。")

    category_name, filename = KNOWLEDGE_FILES[category]
    source_path = KNOWLEDGE_DIR / filename
    if not source_path.exists():
        return KnowledgeSearchResponse(
            category=category,
            category_name=category_name,
            source_file=str(source_path),
            exists=False,
            total_rows=0,
            matched_count=0,
            results=[],
            message=f"未找到{category_name}知识库文件，请将 Excel 放到 {source_path}。",
        )

    try:
        df = pd.read_excel(source_path, sheet_name=0, engine="openpyxl", dtype=object)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{category_name}知识库 Excel 解析失败：{exc}") from exc

    if category == "policies":
        for column in POLICY_FORWARD_FILL_COLUMNS:
            if column in df.columns:
                df[column] = df[column].ffill()

    total_rows = len(df)
    tokens = [part.lower() for part in query.strip().split() if part.strip()]
    matched: list[tuple[int, int, dict[str, str]]] = []

    for index, row in df.iterrows():
        fields = _row_to_fields(row)
        if not fields:
            continue
        haystack = " ".join(fields.values()).lower()
        if tokens:
            if not all(token in haystack for token in tokens):
                continue
            score = sum(haystack.count(token) for token in tokens)
        else:
            score = 0
        matched.append((score, int(index) + 2, fields))

    if tokens:
        matched.sort(key=lambda item: (-item[0], item[1]))

    results = [_build_item(category, row_index, fields) for _, row_index, fields in matched[:limit]]
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
