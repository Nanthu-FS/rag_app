"""Calculator agent — the brain TRANSLATES, sympy COMPUTES.

The single most important reliability rule in Personal Intelligence: a local LLM is never
trusted to do arithmetic. The model's only job here is to turn natural language
("18% tip on 64.50", "square root of 144 plus 7") into a math expression; the
actual evaluation is done deterministically by sympy. Wrong-arithmetic
hallucinations simply cannot happen.
"""

from __future__ import annotations

import sympy
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

from agents import AgentResult
from ollama_client import chat_json

_TRANSLATE_SYSTEM = """You convert a natural-language math question into a single
arithmetic expression that Python's sympy can evaluate.

- Use only: numbers, + - * / ** ( ), and functions sqrt, sin, cos, tan, log, exp, pi, E.
- Percent: write "18% of 64.50" as 0.18*64.50.
- Do NOT compute the answer yourself. Do NOT add words or units.
- If the question is not actually solvable as a numeric expression, return an empty expr.

Return ONLY JSON: {"expr": "...", "note": "what it represents"}"""

_TRANSFORMS = standard_transformations + (
    convert_xor,                            # let ^ mean power
    implicit_multiplication_application,    # allow "2 pi" etc.
)


def _safe_eval(expr: str) -> str | None:
    """Evaluate a math expression with sympy; return a clean string or None."""
    try:
        parsed = parse_expr(expr, transformations=_TRANSFORMS, evaluate=True)
        value = sympy.N(parsed)  # numeric evaluation
    except (sympy.SympifyError, SyntaxError, TypeError, ValueError):
        return None

    # Render integers without a trailing ".0"; round floats to something readable.
    try:
        f = float(value)
    except (TypeError, ValueError):
        return str(value)
    if f == int(f):
        return str(int(f))
    return f"{f:.6g}"


async def run(query: str) -> AgentResult:
    data = await chat_json(_TRANSLATE_SYSTEM, query, temperature=0.0)
    expr = (data.get("expr") or "").strip() if isinstance(data, dict) else ""
    note = (data.get("note") or "").strip() if isinstance(data, dict) else ""

    if not expr:
        return AgentResult(
            name="calculator",
            answer="(could not parse this as a numeric calculation)",
            ok=False,
        )

    result = _safe_eval(expr)
    if result is None:
        return AgentResult(
            name="calculator",
            answer=f"(could not evaluate the expression `{expr}`)",
            ok=False,
        )

    detail = f" — {note}" if note else ""
    return AgentResult(
        name="calculator",
        answer=f"{expr} = {result}{detail}",
    )
