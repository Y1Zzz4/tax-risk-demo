from io import BytesIO

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.schemas import ParsedReportItem, ReportParseResponse


QKSM_MISSING_MESSAGE = "未识别到“情况说明”字段，请确认上传文件是否包含 qksm 列。"


def _get_text(row: pd.Series, column: object | None) -> str | None:
    if column is None:
        return None
    value = row.get(column)
    if pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


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
    qksm_column = normalized_columns.get("qksm")
    if qksm_column is None:
        raise HTTPException(status_code=400, detail=QKSM_MISSING_MESSAGE)
    record_id_column = normalized_columns.get("djxh")
    taxpayer_name_column = normalized_columns.get("nsrmc")
    task_name_column = normalized_columns.get("fxrwmc")

    reports: list[ParsedReportItem] = []
    for index, value in df[qksm_column].items():
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
                preview=text[:120],
                full_text=text,
                text_length=len(text),
            )
        )

    if not reports:
        raise HTTPException(status_code=400, detail="“情况说明”字段中未发现非空报告正文，请确认上传文件内容。")

    return ReportParseResponse(reports=reports)
