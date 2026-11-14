"""Deterministic generation for local acceptance tests and demonstrations."""

import re


def shorten(value, limit):
    value = " ".join(value.split())
    return value if len(value) <= limit else value[:limit - 1].rstrip() + "…"


def group(title, items):
    return {"title": title, "items": items}


def proposal(title, summary, *, question="", groups=None, nodes=None, edges=None):
    return {
        "title": title,
        "summary": summary,
        "question": question,
        "groups": groups or [],
        "nodes": nodes or [],
        "edges": edges or [],
    }


def generate_mock(request):
    chinese = bool(re.search(r"[\u3400-\u9fff]", request.prompt))
    if not request.answer and (
        len(request.prompt) < 8 or request.prompt.casefold().startswith(("clarify", "请先澄清"))
    ):
        return proposal(
            "画板草案" if chinese else "Board draft",
            "",
            question="这张画板应帮助团队做出什么决定？" if chinese else "What decision should this board help the team make?",
        )
    if request.workflow == "flowchart":
        return flowchart(request, chinese)
    if request.workflow == "organize":
        return organize(request, chinese)
    return workshop(request, chinese)


def flowchart(request, chinese):
    labels = [
        shorten(part.strip(" ：:。.;"), 180)
        for part in re.split(r"\s*(?:->|=>|→|➜)\s*", request.prompt)
        if part.strip(" ：:。.;")
    ]
    if len(labels) < 2:
        labels = (
            ["明确需求", "评审方案", "执行并发布", "验证结果"] if chinese
            else ["Clarify the request", "Review the approach", "Deliver the change", "Verify the outcome"]
        )
    nodes = [{"id": f"step_{index + 1}", "label": label} for index, label in enumerate(labels[:16])]
    edges = [
        {"from": start["id"], "to": end["id"], "label": ""}
        for start, end in zip(nodes, nodes[1:])
    ]
    text = (request.prompt + " · " + request.answer) if request.answer else request.prompt
    return proposal("流程草案" if chinese else "Process draft", shorten(text, 280), nodes=nodes, edges=edges)


def workshop(request, chinese):
    focus = shorten(request.answer or request.prompt, 230)
    retrospective = any(word in request.prompt.casefold() for word in ("retro", "复盘", "回顾"))
    title = ("团队复盘" if retrospective else "团队工作坊") if chinese else ("Team retrospective" if retrospective else "Team workshop")
    if chinese:
        sections = [
            group("目标与背景", [focus, "共同确认讨论范围与预期结果"]),
            group("团队讨论", ["写下近期的具体观察", "归类重复问题并标出分歧", "选出最值得解决的两个问题"]),
            group("行动项", ["明确下一步行动和负责人", "为每项行动约定截止时间与复查日期"]),
        ]
    else:
        sections = [
            group("Goal and context", [focus, "Agree on the scope and the desired outcome"]),
            group("Team discussion", ["Write down concrete observations", "Group repeated themes and flag disagreements", "Choose two priorities"]),
            group("Next actions", ["Assign an owner to each next action", "Set due dates and schedule a check-in"]),
        ]
    if request.context:
        sections.append(group(
            "参考便签" if chinese else "Selected notes",
            [shorten(text, 280) for text in request.context[:8]],
        ))
    return proposal(title, shorten(request.prompt, 280), groups=sections)


def organize(request, chinese):
    title = "整理选中便签" if chinese else "Organized notes"
    if not request.context and not request.answer:
        return proposal(title, "", question=(
            "请提供要整理的便签内容。" if chinese else "Which notes or ideas would you like to organize?"
        ))
    headings = (
        ["行动项", "风险与问题", "决策", "观察与想法"] if chinese
        else ["Next actions", "Risks and questions", "Decisions", "Observations and ideas"]
    )
    sections = [[] for _ in headings]
    for text in request.context or (request.answer,):
        item = shorten(text, 280)
        key = item.casefold()
        if any(word in key for word in ("todo", "action", "follow up", "owner", "行动", "负责人", "下一步")):
            index = 0
        elif any(word in key for word in ("risk", "blocked", "issue", "?", "？", "风险", "阻塞", "问题")):
            index = 1
        elif any(word in key for word in ("decision", "approved", "agreed", "决策", "通过", "同意")):
            index = 2
        else:
            index = 3
        sections[index].append(item)
    groups = []
    for heading, items in zip(headings, sections):
        for offset in range(0, len(items), 8):
            suffix = f" {offset // 8 + 1}" if offset else ""
            groups.append(group(heading + suffix, items[offset:offset + 8]))
    return proposal(title, shorten(request.prompt, 280), groups=groups)
