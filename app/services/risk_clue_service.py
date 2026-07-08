from io import BytesIO

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.schemas import RiskClueItem, RiskClueParseResponse


EXPECTED_COLUMNS = ("序号", "纳税人名称", "疑点名称", "风险所属期", "风险描述")
HEADER_MARKERS = {"序号", "纳税人名称", "疑点名称", "风险所属期", "风险描述"}


def _text(value: object, default: str = "") -> str:
    if pd.isna(value):
        return default
    text = str(value).strip()
    return text if text and text.lower() != "nan" else default


def _is_header_row(row: pd.Series) -> bool:
    values = {_text(value).replace(" ", "") for value in row.iloc[:5].tolist()}
    return len(values & HEADER_MARKERS) >= 2 or "纳税人名称" in values


async def parse_risk_clue_excel(file: UploadFile) -> RiskClueParseResponse:
    filename = file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持上传 .xlsx 格式的下发疑点清单。")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空，请重新选择 .xlsx 文件。")

    try:
        raw_df = pd.read_excel(BytesIO(content), sheet_name=0, engine="openpyxl", header=None, dtype=object)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"下发疑点清单解析失败，请确认文件格式正确：{exc}") from exc

    raw_df = raw_df.dropna(how="all")
    if raw_df.empty:
        raise HTTPException(status_code=400, detail="下发疑点清单未发现有效数据。")
    if raw_df.shape[1] < 5:
        raise HTTPException(status_code=400, detail="下发疑点清单至少需要 5 列：序号、纳税人名称、疑点名称、风险所属期、风险描述。")

    start_row = 1 if _is_header_row(raw_df.iloc[0]) else 0
    df = raw_df.iloc[start_row:, :5].copy()
    df.columns = EXPECTED_COLUMNS
    df["纳税人名称"] = df["纳税人名称"].ffill()

    clues: list[RiskClueItem] = []
    for position, (_, row) in enumerate(df.iterrows(), start=start_row + 1):
        sequence_no = _text(row["序号"], default=str(len(clues) + 1))
        taxpayer_name = _text(row["纳税人名称"])
        risk_name = _text(row["疑点名称"], default="未提供")
        risk_period = _text(row["风险所属期"], default="未提供")
        risk_description = _text(row["风险描述"], default="未提供")

        if not taxpayer_name and risk_name == "未提供" and risk_description == "未提供":
            continue
        if not taxpayer_name:
            raise HTTPException(status_code=400, detail=f"第 {position + 1} 行缺少纳税人名称，无法按公司归集风险点。")

        clues.append(
            RiskClueItem(
                row_index=position + 1,
                sequence_no=sequence_no,
                taxpayer_name=taxpayer_name,
                risk_name=risk_name,
                risk_period=risk_period,
                risk_description=risk_description,
            )
        )

    if not clues:
        raise HTTPException(status_code=400, detail="下发疑点清单未发现可解析的风险记录。")

    company_count = len({item.taxpayer_name for item in clues})
    return RiskClueParseResponse(clues=clues, total_count=len(clues), company_count=company_count)
