from typing import Literal

from pydantic import AliasChoices, BaseModel, Field


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=6000)


class ChatResponse(BaseModel):
    answer_summary: str
    question_understanding: str
    verification_directions: list[str]
    suggested_measures: list[str]
    reference_materials: list[str] = Field(
        validation_alias=AliasChoices("reference_materials", "supplementary_materials")
    )
    risk_notice: str


class ParsedReportItem(BaseModel):
    row_index: int
    record_id: str | None = None
    taxpayer_name: str | None = None
    task_name: str | None = None
    risk_brief: str | None = None
    manual_conclusion: str | None = None
    rectification_status: str | None = None
    preview: str
    full_text: str
    text_length: int


class ReportParseResponse(BaseModel):
    reports: list[ParsedReportItem]


class ReportReviewRequest(BaseModel):
    report_text: str = Field(..., min_length=1, max_length=60000)
    record_id: str | None = None
    taxpayer_name: str | None = None
    task_name: str | None = None
    risk_brief: str | None = None
    manual_conclusion: str | None = None
    rectification_status: str | None = None


class StructureRow(BaseModel):
    standard_title: str
    actual_expression: str
    match_status: Literal["匹配", "部分匹配", "未匹配"]


class StructureAnalysis(BaseModel):
    rows: list[StructureRow]
    note: str


class KeywordCheck(BaseModel):
    status: str
    content: str


class CompletenessRow(BaseModel):
    assigned_issue: str
    verification_status: str
    coverage_status: Literal["已覆盖", "部分覆盖", "未覆盖", "无法判断"]
    data_support: str


class ResponseCompletenessCheck(BaseModel):
    rows: list[CompletenessRow]
    note: str
    conclusion: str


class ConclusionRow(BaseModel):
    risk_point: str
    treatment_measure: str
    match_status: Literal["匹配", "部分匹配", "未匹配", "无法判断"]


class ResponseConclusionCheck(BaseModel):
    rows: list[ConclusionRow]
    note: str
    tip: str
    conclusion: str


class ManualConclusionSupportCheck(BaseModel):
    manual_conclusion: Literal["有问题", "无问题", "未提供"]
    support_status: Literal["支撑充分", "部分支撑", "支撑不足", "无法判断"]
    evidence_summary: str
    gap_analysis: str
    conclusion: str


class QualityEvaluation(BaseModel):
    overall_level: Literal["较完整", "基本完整", "待完善", "无法判断"]
    strengths: list[str]
    deficiencies: list[str]
    improvement_suggestions: list[str]


class ReviewSummary(BaseModel):
    specific_situation: list[str]
    analysis_conclusion: str


class ReportReviewResponse(BaseModel):
    report_object: str
    report_summary: str
    structure_analysis: StructureAnalysis
    keyword_check: KeywordCheck
    response_completeness_check: ResponseCompletenessCheck
    response_conclusion_check: ResponseConclusionCheck
    manual_conclusion_support_check: ManualConclusionSupportCheck
    quality_evaluation: QualityEvaluation
    review_summary: ReviewSummary
    final_review_opinion: str
