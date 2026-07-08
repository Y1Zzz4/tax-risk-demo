from io import BytesIO

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.schemas import ParsedReportItem, ReportParseResponse


REPORT_TEXT_MISSING_MESSAGE = "未识别到“情况说明”字段，请确认上传文件是否包含该列。"
MANUAL_CONCLUSION_VALUES = {"有问题", "无问题"}


def _find_column(normalized_columns: dict[str, object], aliases: tuple[str, ...]) -> object | None:
    for alias in aliases:
        column = normalized_columns.get(alias.strip().lower())
        if column is not None:
            return column
    return None


def _get_text(row: pd.Series, column: object | None) -> str | None:
    if column is None:
        return None
    value = row.get(column)
    if pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def _get_manual_conclusion(row: pd.Series, column: object | None) -> str | None:
    text = _get_text(row, column)
    if text is None:
        return None
    if text in MANUAL_CONCLUSION_VALUES:
        return text
    raise HTTPException(status_code=400, detail="“人工认定结果”字段仅支持“有问题”或“无问题”。")


async def parse_report_excel(file: UploadFile) -> ReportParseResponse:
    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持上传 .xlsx 格式的 Excel 文件。")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空，请重新选择 .xlsx 文件。")

    try:
        df = pd.read_excel(BytesIO(content), sheet_name=0, engine="openpyxl")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Excel 解析失败，请确认文件格式正确：{exc}") from exc

    normalized_columns = {str(col).strip().lower(): col for col in df.columns}
    report_text_column = _find_column(normalized_columns, ("情况说明", "qksm"))
    if report_text_column is None:
        raise HTTPException(status_code=400, detail=REPORT_TEXT_MISSING_MESSAGE)
    record_id_column = _find_column(normalized_columns, ("报告编号", "djxh"))
    taxpayer_name_column = _find_column(normalized_columns, ("纳税人名称", "nsrmc"))
    task_name_column = _find_column(normalized_columns, ("风险任务名称", "fxrwmc"))
    risk_brief_column = _find_column(normalized_columns, ("疑点信息", "ydxx"))
    manual_conclusion_column = _find_column(normalized_columns, ("人工认定结果", "sfywt"))
    rectification_status_column = _find_column(normalized_columns, ("申报更正情况", "sbgzqk"))

    reports: list[ParsedReportItem] = []
    for index, value in df[report_text_column].items():
        if pd.isna(value):
            continue
        text = str(value).strip()
        if not text:
            continue
        reports.append(
            ParsedReportItem(
                row_index=int(index) + 2,
                record_id=_get_text(df.loc[index], record_id_column),
                taxpayer_name=_get_text(df.loc[index], taxpayer_name_column),
                task_name=_get_text(df.loc[index], task_name_column),
                risk_brief=_get_text(df.loc[index], risk_brief_column),
                manual_conclusion=_get_manual_conclusion(df.loc[index], manual_conclusion_column),
                rectification_status=_get_text(df.loc[index], rectification_status_column),
                preview=text[:120],
                full_text=text,
                text_length=len(text),
            )
        )

    if not reports:
        raise HTTPException(status_code=400, detail="“情况说明”字段中未发现非空报告正文，请确认上传文件内容。")

    return ReportParseResponse(reports=reports)
