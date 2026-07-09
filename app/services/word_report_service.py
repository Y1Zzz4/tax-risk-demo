from __future__ import annotations

import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree

from fastapi import HTTPException, UploadFile

from app.schemas import WordReportParseResponse, WordRiskPoint


WORD_NAMESPACE = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
RISK_POINT_PATTERN = re.compile(r"^风险点\s*([一二三四五六七八九十百\d]+)\s*[：:、.．]?\s*(.*)$")
FIELD_PATTERNS = {
    "description": re.compile(r"^风险点具体描述\s*[：:]?\s*(.*)$"),
    "verification": re.compile(r"^验证情况\s*[：:]?\s*(.*)$"),
    "policy_basis": re.compile(r"^政策依据\s*[：:]?\s*(.*)$"),
    "proposed_opinion": re.compile(r"^拟处理意见\s*[：:]?\s*(.*)$"),
}
PROPOSED_OPINION_VALUES = ("风险排除", "风险确认")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _compact_text(text: str) -> str:
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()


def _paragraph_text(paragraph: ElementTree.Element) -> str:
    parts: list[str] = []
    for node in paragraph.iter():
        name = _local_name(node.tag)
        if name == "t" and node.text:
            parts.append(node.text)
        elif name == "tab":
            parts.append("\t")
        elif name in {"br", "cr"}:
            parts.append("\n")
    return _compact_text("".join(parts))


def _table_text(table: ElementTree.Element) -> list[str]:
    rows: list[str] = []
    for row in table.findall(f".//{WORD_NAMESPACE}tr"):
        cells: list[str] = []
        for cell in row.findall(f"{WORD_NAMESPACE}tc"):
            paragraphs = [_paragraph_text(paragraph) for paragraph in cell.findall(f".//{WORD_NAMESPACE}p")]
            cell_text = "；".join(text for text in paragraphs if text)
            if cell_text:
                cells.append(cell_text)
        if cells:
            rows.append(" | ".join(cells))
    return rows


def _extract_docx_blocks(content: bytes) -> list[str]:
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            document_xml = archive.read("word/document.xml")
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="Word 文档缺少 word/document.xml，无法解析正文。") from exc
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="文件不是有效的 .docx 文档。") from exc

    try:
        root = ElementTree.fromstring(document_xml)
    except ElementTree.ParseError as exc:
        raise HTTPException(status_code=400, detail=f"Word 文档 XML 解析失败：{exc}") from exc

    body = root.find(f"{WORD_NAMESPACE}body")
    if body is None:
        raise HTTPException(status_code=400, detail="Word 文档未识别到正文内容。")

    blocks: list[str] = []
    for child in body:
        name = _local_name(child.tag)
        if name == "p":
            text = _paragraph_text(child)
            if text:
                blocks.append(text)
        elif name == "tbl":
            blocks.extend(_table_text(child))
    return blocks


def _lines_to_text(lines: list[str]) -> str | None:
    text = "\n".join(line for line in lines if line).strip()
    return text or None


def _find_line_index(lines: list[str], keyword: str) -> int | None:
    for index, line in enumerate(lines):
        normalized = re.sub(r"\s+", "", line)
        if keyword in normalized:
            return index
    return None


def _find_first_risk_index(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        if RISK_POINT_PATTERN.match(line):
            return index
    return None


def _field_key(line: str) -> tuple[str, str] | None:
    for key, pattern in FIELD_PATTERNS.items():
        match = pattern.match(line)
        if match:
            return key, match.group(1).strip()
    return None


def _parse_risk_fields(lines: list[str]) -> dict[str, str | None]:
    fields: dict[str, list[str]] = {
        "description": [],
        "verification": [],
        "policy_basis": [],
        "proposed_opinion": [],
    }
    current_key: str | None = None

    for line in lines:
        field_match = _field_key(line)
        if field_match:
            current_key, inline_text = field_match
            if inline_text:
                fields[current_key].append(inline_text)
            continue
        if current_key:
            fields[current_key].append(line)
        else:
            fields["description"].append(line)

    return {key: _lines_to_text(value) for key, value in fields.items()}


def _proposed_opinion_status(text: str | None) -> str:
    if not text:
        return "未识别"
    stripped = text.strip()
    if stripped in PROPOSED_OPINION_VALUES:
        return stripped
    for value in PROPOSED_OPINION_VALUES:
        if value in stripped:
            return value
    return "未识别"


def _is_exact_proposed_opinion(text: str | None) -> bool:
    return bool(text and text.strip() in PROPOSED_OPINION_VALUES)


def _parse_risk_points(lines: list[str], warnings: list[str]) -> list[WordRiskPoint]:
    points: list[WordRiskPoint] = []
    current_header: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        if current_header is None:
            return
        header_match = RISK_POINT_PATTERN.match(current_header)
        label = header_match.group(1).strip() if header_match else None
        title = header_match.group(2).strip() if header_match and header_match.group(2).strip() else current_header
        fields = _parse_risk_fields(current_lines)
        proposed_status = _proposed_opinion_status(fields["proposed_opinion"])
        point = WordRiskPoint(
            index=len(points) + 1,
            label=label,
            title=title,
            description=fields["description"],
            verification=fields["verification"],
            policy_basis=fields["policy_basis"],
            proposed_opinion=fields["proposed_opinion"],
            proposed_opinion_status=proposed_status,
            raw_text="\n".join([current_header, *current_lines]).strip(),
        )
        for field_name, label in (
            ("description", "风险点具体描述"),
            ("verification", "验证情况"),
            ("policy_basis", "政策依据"),
            ("proposed_opinion", "拟处理意见"),
        ):
            if getattr(point, field_name) is None:
                warnings.append(f"风险点{point.index}“{point.title}”未识别到“{label}”。")
        if proposed_status == "未识别":
            warnings.append(f"风险点{point.index}“{point.title}”的“拟处理意见”未识别为“风险排除”或“风险确认”。")
        elif not _is_exact_proposed_opinion(fields["proposed_opinion"]):
            warnings.append(f"风险点{point.index}“{point.title}”的“拟处理意见”应仅填写“风险排除”或“风险确认”。")
        points.append(point)

    for line in lines:
        if RISK_POINT_PATTERN.match(line):
            flush()
            current_header = line
            current_lines = []
        elif current_header is not None:
            current_lines.append(line)

    flush()
    return points


def parse_word_report_content(filename: str, content: bytes) -> WordReportParseResponse:
    blocks = _extract_docx_blocks(content)
    lines = [_compact_text(block) for block in blocks if _compact_text(block)]
    if not lines:
        raise HTTPException(status_code=400, detail="Word 文档未提取到有效文本。")

    warnings: list[str] = []
    basic_index = _find_line_index(lines, "应对任务基本情况")
    task_index = _find_line_index(lines, "任务具体情况")

    if basic_index is None:
        warnings.append("未识别到“应对任务基本情况”标题。")
    if task_index is None:
        warnings.append("未识别到“任务具体情况”标题。")

    basic_info: str | None = None
    if basic_index is not None:
        basic_end = task_index if task_index is not None and task_index > basic_index else len(lines)
        basic_info = _lines_to_text(lines[basic_index + 1 : basic_end])

    task_lines = lines[task_index + 1 :] if task_index is not None else lines
    first_risk_index = _find_first_risk_index(task_lines)
    if first_risk_index is None:
        warnings.append("未识别到“风险点x：xx风险”格式的风险点标题。")
        task_summary = _lines_to_text(task_lines)
        risk_points: list[WordRiskPoint] = []
    else:
        task_summary = _lines_to_text(task_lines[:first_risk_index])
        risk_points = _parse_risk_points(task_lines[first_risk_index:], warnings)

    if task_summary is None:
        warnings.append("任务具体情况部分未识别到总体概括。")

    full_text = "\n".join(lines)
    return WordReportParseResponse(
        filename=filename,
        full_text=full_text,
        text_length=len(full_text),
        preview=full_text[:300],
        basic_info=basic_info,
        task_summary=task_summary,
        risk_points=risk_points,
        warnings=warnings,
    )


async def parse_word_report(file: UploadFile) -> WordReportParseResponse:
    filename = file.filename or ""
    if filename.lower().endswith(".doc"):
        raise HTTPException(status_code=400, detail="暂不支持旧版 .doc 格式，请另存为 .docx 后上传。")
    if not filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="仅支持上传 .docx 格式的 Word 报告。")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空，请重新选择 .docx 文件。")

    return parse_word_report_content(filename, content)
