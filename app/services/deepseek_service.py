import json
import re
from typing import Any, TypeVar

from fastapi import HTTPException
from openai import APIConnectionError, APIError, APITimeoutError, OpenAI
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.prompts import (
    CHAT_SYSTEM_PROMPT,
    COMPANY_RISK_ADVICE_SYSTEM_PROMPT,
    REPORT_REVIEW_SYSTEM_PROMPT,
    WORD_REPORT_REVIEW_SYSTEM_PROMPT,
)
from app.schemas import ChatResponse, ReportReviewResponse, RiskClueItem, WordRiskPoint


T = TypeVar("T", bound=BaseModel)


class DeepSeekService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client: OpenAI | None = None
        if self.settings.deepseek_api_key:
            self.client = OpenAI(
                api_key=self.settings.deepseek_api_key,
                base_url=self.settings.deepseek_base_url,
                timeout=self.settings.request_timeout_seconds,
            )

    def _ensure_client(self) -> OpenAI:
        if self.client is None:
            raise HTTPException(
                status_code=503,
                detail="未配置 DEEPSEEK_API_KEY。请在 .env 中配置 DeepSeek API Key 后重启服务。",
            )
        return self.client

    def _chat_json(self, system_prompt: str, user_content: str, temperature: float) -> str:
        client = self._ensure_client()
        try:
            response = client.chat.completions.create(
                model=self.settings.deepseek_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
        except APITimeoutError as exc:
            raise HTTPException(status_code=504, detail="DeepSeek API 请求超时，请稍后重试。") from exc
        except APIConnectionError as exc:
            raise HTTPException(status_code=502, detail="无法连接 DeepSeek API，请检查网络或 BASE_URL 配置。") from exc
        except APIError as exc:
            message = getattr(exc, "message", None) or str(exc)
            raise HTTPException(status_code=502, detail=f"DeepSeek API 调用失败：{message}") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"模型调用异常：{exc}") from exc

        content = response.choices[0].message.content if response.choices else None
        if not content:
            raise HTTPException(status_code=502, detail="DeepSeek API 未返回有效内容。")
        return content

    @staticmethod
    def _load_json(content: str) -> dict[str, Any]:
        content = content.strip()
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content, flags=re.IGNORECASE)
        if fence_match:
            try:
                parsed = json.loads(fence_match.group(1).strip())
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

        raise HTTPException(
            status_code=502,
            detail="模型返回内容不是合格 JSON，且无法从 markdown JSON 代码块中提取。请重试或降低输入复杂度。",
        )

    @staticmethod
    def _validate(parsed: dict[str, Any], model: type[T]) -> T:
        try:
            return model.model_validate(parsed)
        except ValidationError as exc:
            raise HTTPException(status_code=502, detail=f"模型 JSON 结构不符合接口要求：{exc.errors()}") from exc

    @staticmethod
    def _coerce_literal(value: Any, allowed: tuple[str, ...], default: str) -> str:
        text = str(value or "").strip()
        if text in allowed:
            return text
        for candidate in allowed:
            if candidate in text:
                return candidate
        return default

    @classmethod
    def _normalize_review_json(cls, parsed: dict[str, Any], *, manual_conclusion_default: str = "未提供") -> dict[str, Any]:
        structure = parsed.get("structure_analysis")
        if isinstance(structure, dict):
            for row in structure.get("rows") or []:
                if isinstance(row, dict):
                    row["match_status"] = cls._coerce_literal(row.get("match_status"), ("匹配", "部分匹配", "未匹配"), "未匹配")

        completeness = parsed.get("response_completeness_check")
        if isinstance(completeness, dict):
            for row in completeness.get("rows") or []:
                if isinstance(row, dict):
                    row["coverage_status"] = cls._coerce_literal(
                        row.get("coverage_status"),
                        ("已覆盖", "部分覆盖", "未覆盖", "无法判断"),
                        "无法判断",
                    )

        conclusion = parsed.get("response_conclusion_check")
        if isinstance(conclusion, dict):
            for row in conclusion.get("rows") or []:
                if isinstance(row, dict):
                    row["match_status"] = cls._coerce_literal(
                        row.get("match_status"),
                        ("匹配", "部分匹配", "未匹配", "无法判断"),
                        "无法判断",
                    )

        support = parsed.get("manual_conclusion_support_check")
        if isinstance(support, dict):
            support["manual_conclusion"] = cls._coerce_literal(
                support.get("manual_conclusion"),
                ("有问题", "无问题", "未提供"),
                manual_conclusion_default,
            )
            support["support_status"] = cls._coerce_literal(
                support.get("support_status"),
                ("支撑充分", "部分支撑", "支撑不足", "无法判断"),
                "无法判断",
            )

        quality = parsed.get("quality_evaluation")
        if isinstance(quality, dict):
            quality["overall_level"] = cls._coerce_literal(
                quality.get("overall_level"),
                ("较完整", "基本完整", "待完善", "无法判断"),
                "无法判断",
            )
        return parsed

    def answer_question(self, question: str) -> ChatResponse:
        content = self._chat_json(
            CHAT_SYSTEM_PROMPT,
            f"请基于以下问题生成辅助研判结果：\n\n{question}",
            temperature=0.35,
        )
        parsed = self._load_json(content)
        if "reference_materials" not in parsed and "supplementary_materials" in parsed:
            parsed["reference_materials"] = parsed["supplementary_materials"]
        if "answer_summary" not in parsed:
            parsed["answer_summary"] = parsed.get("question_understanding", "")
        return self._validate(parsed, ChatResponse)

    @staticmethod
    def _format_risk_clues(risk_clues: list[RiskClueItem]) -> str:
        lines = []
        for item in risk_clues:
            lines.append(
                "；".join(
                    [
                        f"序号：{item.sequence_no}",
                        f"纳税人名称：{item.taxpayer_name}",
                        f"疑点名称：{item.risk_name}",
                        f"风险所属期：{item.risk_period}",
                        f"风险描述：{item.risk_description}",
                    ]
                )
            )
        return "\n".join(lines)

    def answer_company_risk(self, taxpayer_name: str, risk_clues: list[RiskClueItem], *, question: str = "") -> ChatResponse:
        risk_clue_text = self._format_risk_clues(risk_clues)
        user_requirement = question or "请根据该企业下发疑点清单，辅助税务人员形成风险应对建议。"
        content = self._chat_json(
            COMPANY_RISK_ADVICE_SYSTEM_PROMPT,
            (
                f"【纳税人名称】\n{taxpayer_name}\n\n"
                f"【下发疑点清单】\n{risk_clue_text}\n\n"
                f"【用户补充要求】\n{user_requirement}"
            ),
            temperature=0.25,
        )
        parsed = self._load_json(content)
        if "reference_materials" not in parsed and "supplementary_materials" in parsed:
            parsed["reference_materials"] = parsed["supplementary_materials"]
        if "answer_summary" not in parsed:
            parsed["answer_summary"] = parsed.get("question_understanding", "")
        return self._validate(parsed, ChatResponse)

    @staticmethod
    def _format_optional_context(fields: list[tuple[str, str | None]]) -> str:
        lines = [f"{label}：{value.strip()}" for label, value in fields if value and value.strip()]
        return "\n".join(lines) if lines else "未提供原表参考字段。"

    @staticmethod
    def _clip_text(text: str | None, limit: int) -> str:
        if not text:
            return "未提供"
        stripped = text.strip()
        if len(stripped) <= limit:
            return stripped
        return f"{stripped[:limit]}\n……（内容较长，已截取前 {limit} 字用于本次模型复核）"

    @classmethod
    def _format_word_risk_points(cls, risk_points: list[WordRiskPoint]) -> str:
        if not risk_points:
            return "未识别到结构化风险点。"
        lines = []
        for point in risk_points:
            lines.append(
                "\n".join(
                    [
                        f"风险点{point.index}：{point.title}",
                        f"风险点具体描述：{cls._clip_text(point.description, 1200)}",
                        f"验证情况：{cls._clip_text(point.verification, 1200)}",
                        f"政策依据：{cls._clip_text(point.policy_basis, 1200)}",
                        f"拟处理意见：{cls._clip_text(point.proposed_opinion, 1200)}",
                    ]
                )
            )
        return "\n\n".join(lines)

    def review_report(
        self,
        report_text: str,
        *,
        record_id: str | None = None,
        taxpayer_name: str | None = None,
        task_name: str | None = None,
        risk_brief: str | None = None,
        manual_conclusion: str | None = None,
        rectification_status: str | None = None,
    ) -> ReportReviewResponse:
        source_context = self._format_optional_context(
            [
                ("报告编号", record_id),
                ("纳税人名称", taxpayer_name),
                ("风险任务名称", task_name),
                ("疑点信息", risk_brief),
                ("人工认定结果", manual_conclusion),
                ("申报更正情况", rectification_status),
            ]
        )
        content = self._chat_json(
            REPORT_REVIEW_SYSTEM_PROMPT,
            (
                "请复核以下风控核查报告。原表参考字段用于理解风险事项和工作人员人工认定结果，"
                "“情况说明”是复核主体。请仅依据这些输入输出指定 JSON。\n\n"
                f"【原表参考字段】\n{source_context}\n\n"
                f"【情况说明】\n{report_text}"
            ),
            temperature=0.15,
        )
        parsed = self._load_json(content)
        if "manual_conclusion_support_check" not in parsed:
            parsed["manual_conclusion_support_check"] = {
                "manual_conclusion": manual_conclusion or "未提供",
                "support_status": "无法判断",
                "evidence_summary": "模型未返回人工认定结果支撑性检查。",
                "gap_analysis": "建议人工复核情况说明是否充分支撑人工认定结果。",
                "conclusion": "未发现对应结构化检查结果，建议人工复核。",
            }
        parsed = self._normalize_review_json(parsed, manual_conclusion_default=manual_conclusion or "未提供")
        result = self._validate(parsed, ReportReviewResponse)
        result.keyword_check.status = "暂未启用"
        result.keyword_check.content = "当前版本暂未接入既有关键字检索指标与规则库，本项不作自动命中判定。"
        return result

    def review_word_report(
        self,
        *,
        filename: str | None,
        full_text: str,
        basic_info: str | None,
        task_summary: str | None,
        risk_points: list[WordRiskPoint],
        warnings: list[str],
    ) -> ReportReviewResponse:
        content = self._chat_json(
            WORD_REPORT_REVIEW_SYSTEM_PROMPT,
            (
                "请复核以下 Word 完整风险应对报告。解析警告用于提示文档结构可能缺失或不规范。"
                "请仅依据这些输入输出指定 JSON。\n\n"
                f"【文件名】\n{filename or '未提供'}\n\n"
                f"【解析警告】\n{chr(10).join(warnings) if warnings else '未发现解析警告。'}\n\n"
                f"【应对任务基本情况】\n{self._clip_text(basic_info, 5000)}\n\n"
                f"【任务具体情况总体概括】\n{self._clip_text(task_summary, 5000)}\n\n"
                f"【结构化风险点】\n{self._format_word_risk_points(risk_points)}\n\n"
                f"【全文节选】\n{self._clip_text(full_text, 30000)}"
            ),
            temperature=0.12,
        )
        parsed = self._load_json(content)
        if "manual_conclusion_support_check" not in parsed:
            parsed["manual_conclusion_support_check"] = {
                "manual_conclusion": "未提供",
                "support_status": "无法判断",
                "evidence_summary": "模型未返回完整报告拟处理意见支撑性检查。",
                "gap_analysis": "建议人工复核验证情况、政策依据和拟处理意见是否形成支撑链条。",
                "conclusion": "未发现对应结构化检查结果，建议人工复核。",
            }
        parsed = self._normalize_review_json(parsed, manual_conclusion_default="未提供")
        result = self._validate(parsed, ReportReviewResponse)
        result.keyword_check.status = "暂未启用"
        result.keyword_check.content = "当前版本暂未接入既有关键字检索指标与规则库，本项不作自动命中判定。"
        return result
