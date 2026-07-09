from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import get_settings
from app.schemas import (
    ChatRequest,
    ChatResponse,
    CompanyRiskAdviceRequest,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
    ReportParseResponse,
    ReportReviewRequest,
    ReportReviewResponse,
    RiskClueParseResponse,
    WordReportParseResponse,
    WordReportReviewRequest,
)
from app.services.deepseek_service import DeepSeekService
from app.services.excel_service import parse_report_excel
from app.services.knowledge_service import KnowledgeCategory, search_knowledge
from app.services.risk_clue_service import parse_risk_clue_excel
from app.services.word_report_service import parse_word_report


settings = get_settings()
app = FastAPI(title=settings.app_name)
templates = Jinja2Templates(directory="app/templates")
deepseek_service = DeepSeekService()

app.mount("/static", StaticFiles(directory="app/static"), name="static")


PAGE_CONFIG = {
    "smart-response": {"label": "智能应对", "section": "服务模块"},
    "report-review": {"label": "报告复核", "section": "服务模块"},
    "policies": {"label": "政策法规", "section": "知识库"},
    "cases": {"label": "历史案例", "section": "知识库"},
}


def render_page(request: Request, page: str) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "app_name": settings.app_name,
            "active_page": page,
            "page_config": PAGE_CONFIG,
        },
    )


@app.get("/")
async def index() -> RedirectResponse:
    return RedirectResponse(url="/service/smart-response")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse("app/static/favicon.svg", media_type="image/svg+xml")


@app.get("/service/smart-response", response_class=HTMLResponse)
async def smart_response_page(request: Request) -> HTMLResponse:
    return render_page(request, "smart-response")


@app.get("/service/report-review", response_class=HTMLResponse)
async def report_review_page(request: Request) -> HTMLResponse:
    return render_page(request, "report-review")


@app.get("/knowledge/policies", response_class=HTMLResponse)
async def policies_page(request: Request) -> HTMLResponse:
    return render_page(request, "policies")


@app.get("/knowledge/cases", response_class=HTMLResponse)
async def cases_page(request: Request) -> HTMLResponse:
    return render_page(request, "cases")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    return deepseek_service.answer_question(payload.question.strip())


@app.post("/api/risk-clues/parse", response_model=RiskClueParseResponse)
async def parse_risk_clues(file: UploadFile = File(...)) -> RiskClueParseResponse:
    return await parse_risk_clue_excel(file)


@app.post("/api/risk-clues/advice", response_model=ChatResponse)
async def advise_company_risk(payload: CompanyRiskAdviceRequest) -> ChatResponse:
    taxpayer_name = payload.taxpayer_name.strip()
    mismatched_clues = [
        item.sequence_no
        for item in payload.risk_clues
        if item.taxpayer_name.strip() != taxpayer_name
    ]
    if mismatched_clues:
        raise HTTPException(
            status_code=400,
            detail=f"应对背景中存在不属于“{taxpayer_name}”的风险点，请重新选择企业后再生成建议。",
        )
    return deepseek_service.answer_company_risk(
        taxpayer_name,
        payload.risk_clues,
        question=payload.question.strip(),
    )


@app.post("/api/report/parse", response_model=ReportParseResponse)
async def parse_report(file: UploadFile = File(...)) -> ReportParseResponse:
    return await parse_report_excel(file)


@app.post("/api/report/word/parse", response_model=WordReportParseResponse)
async def parse_word_report_file(file: UploadFile = File(...)) -> WordReportParseResponse:
    return await parse_word_report(file)


@app.post("/api/report/review", response_model=ReportReviewResponse)
async def review_report(payload: ReportReviewRequest) -> ReportReviewResponse:
    return deepseek_service.review_report(
        payload.report_text.strip(),
        record_id=payload.record_id,
        taxpayer_name=payload.taxpayer_name,
        task_name=payload.task_name,
        risk_brief=payload.risk_brief,
        manual_conclusion=payload.manual_conclusion,
        rectification_status=payload.rectification_status,
    )


@app.post("/api/report/word/review", response_model=ReportReviewResponse)
async def review_word_report(payload: WordReportReviewRequest) -> ReportReviewResponse:
    return deepseek_service.review_word_report(
        filename=payload.filename,
        full_text=payload.full_text.strip(),
        basic_info=payload.basic_info,
        task_summary=payload.task_summary,
        risk_points=payload.risk_points,
        warnings=payload.warnings,
        review_scope=payload.review_scope,
        selected_risk_point_index=payload.selected_risk_point_index,
    )


@app.post("/api/knowledge/{category}/search", response_model=KnowledgeSearchResponse)
async def search_knowledge_base(category: KnowledgeCategory, payload: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
    return search_knowledge(category, payload.query.strip(), payload.limit)
