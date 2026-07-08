from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import get_settings
from app.schemas import ChatRequest, ChatResponse, ReportParseResponse, ReportReviewRequest, ReportReviewResponse
from app.services.deepseek_service import DeepSeekService
from app.services.excel_service import parse_report_excel


settings = get_settings()
app = FastAPI(title=settings.app_name)
templates = Jinja2Templates(directory="app/templates")
deepseek_service = DeepSeekService()

app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html", {"app_name": settings.app_name})


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    return deepseek_service.answer_question(payload.question.strip())


@app.post("/api/report/parse", response_model=ReportParseResponse)
async def parse_report(file: UploadFile = File(...)) -> ReportParseResponse:
    return await parse_report_excel(file)


@app.post("/api/report/review", response_model=ReportReviewResponse)
async def review_report(payload: ReportReviewRequest) -> ReportReviewResponse:
    return deepseek_service.review_report(
        payload.report_text.strip(),
        record_id=payload.record_id,
        taxpayer_name=payload.taxpayer_name,
        task_name=payload.task_name,
        risk_brief=payload.risk_brief,
        manual_has_issue=payload.manual_has_issue,
        rectification_status=payload.rectification_status,
    )
