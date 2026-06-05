#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROMPTS = ROOT / "prompts"
DEFAULT_ROUTER_MODEL = "qwen2.5-coder:14b"
DEFAULT_LOCAL_MODEL = "ollama/qwen2.5-coder:14b"
ROUTES = {"LOCAL_QWEN", "CODEX", "ASK_HUMAN"}
SKIP_DIRS = {".git", "node_modules", "dist", ".venv", "__pycache__"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Route coding tasks to local Qwen, Codex, or a human checkpoint."
    )
    parser.add_argument("task", nargs="*", help="Task to route.")
    parser.add_argument(
        "--router-model",
        default=DEFAULT_ROUTER_MODEL,
        help=f"Ollama model used for routing. Default: {DEFAULT_ROUTER_MODEL}",
    )
    parser.add_argument(
        "--local-model",
        default=DEFAULT_LOCAL_MODEL,
        help=f"Model passed to aider for local edits. Default: {DEFAULT_LOCAL_MODEL}",
    )
    parser.add_argument(
        "--local-command",
        default="aider",
        help="Command used for local Qwen code editing. Default: aider",
    )
    parser.add_argument(
        "--codex-command",
        default="codex",
        help="Command used for complex tasks. Default: codex",
    )
    parser.add_argument(
        "--force",
        choices=sorted(ROUTES),
        help="Skip routing and force a route.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the routing decision without launching an agent.",
    )
    parser.add_argument(
        "--print-prompt",
        action="store_true",
        help="Print the prompt sent to the router and exit.",
    )
    parser.add_argument(
        "--max-files",
        type=int,
        default=300,
        help="Maximum repo files to include in router context.",
    )
    return parser.parse_args()


def read_prompt(name):
    return (PROMPTS / name).read_text(encoding="utf-8").strip()


def task_from_args(parts):
    task = " ".join(parts).strip()
    if task:
        return task
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    return ""


def repo_files(max_files):
    files = []
    for path in sorted(ROOT.rglob("*")):
        if len(files) >= max_files:
            break
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if path.is_file():
            files.append(str(rel))
    return files


def repo_summary(max_files):
    package_json = ROOT / "package.json"
    package = ""
    if package_json.exists():
        try:
            data = json.loads(package_json.read_text(encoding="utf-8"))
            scripts = data.get("scripts", {})
            deps = sorted((data.get("dependencies") or {}).keys())
            package = json.dumps(
                {
                    "name": data.get("name"),
                    "scripts": scripts,
                    "dependencies": deps,
                },
                indent=2,
            )
        except json.JSONDecodeError:
            package = "package.json exists but could not be parsed."

    return {
        "root": str(ROOT),
        "files": repo_files(max_files),
        "package": package,
    }


def build_router_prompt(task, max_files):
    base = read_prompt("router.md")
    context = repo_summary(max_files)
    return f"""{base}

Task:
{task}

Repository context:
{json.dumps(context, indent=2)}
"""


def run_checked(command, input_text=None):
    try:
        return subprocess.run(
            command,
            input=input_text,
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError:
        return None


def extract_json(text):
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return json.loads(stripped)

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        return json.loads(stripped[start : end + 1])

    raise ValueError("Router did not return JSON.")


def normalize_decision(payload):
    route = str(payload.get("route", "")).strip().upper()
    if route not in ROUTES:
        raise ValueError(f"Unknown route: {route or '<empty>'}")

    try:
        confidence = float(payload.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0

    return {
        "route": route,
        "confidence": max(0, min(1, confidence)),
        "reason": str(payload.get("reason", "")).strip() or "No reason provided.",
    }


def route_with_qwen(task, router_model, max_files):
    prompt = build_router_prompt(task, max_files)
    result = run_checked(["ollama", "run", router_model], input_text=prompt)
    if result is None:
        return {
            "route": "ASK_HUMAN",
            "confidence": 1,
            "reason": "ollama is not installed or not on PATH.",
        }
    if result.returncode != 0:
        stderr = result.stderr.strip() or "No stderr."
        return {
            "route": "ASK_HUMAN",
            "confidence": 1,
            "reason": f"Router model failed: {stderr}",
        }

    try:
        return normalize_decision(extract_json(result.stdout))
    except (json.JSONDecodeError, ValueError) as error:
        return {
            "route": "ASK_HUMAN",
            "confidence": 1,
            "reason": f"Could not parse router output: {error}",
        }


def local_agent_message(task):
    prompt = read_prompt("local-coder.md")
    return f"""{prompt}

User task:
{task}
"""


def codex_agent_message(task):
    prompt = read_prompt("codex-coder.md")
    return f"""{prompt}

User task:
{task}
"""


def launch_local(task, args):
    command_path = shutil.which(args.local_command)
    if command_path is None:
        print(
            f"Cannot launch LOCAL_QWEN: '{args.local_command}' is not installed or not on PATH.",
            file=sys.stderr,
        )
        print(
            "Install aider or pass --local-command with a compatible editor command.",
            file=sys.stderr,
        )
        return 127

    message = local_agent_message(task)
    return subprocess.run(
        [command_path, "--model", args.local_model, "--message", message],
        cwd=ROOT,
    ).returncode


def launch_codex(task, args):
    command_path = shutil.which(args.codex_command)
    if command_path is None:
        print(
            f"Cannot launch CODEX: '{args.codex_command}' is not installed or not on PATH.",
            file=sys.stderr,
        )
        return 127

    return subprocess.run([command_path, codex_agent_message(task)], cwd=ROOT).returncode


def main():
    args = parse_args()
    task = task_from_args(args.task)
    if not task:
        print("Provide a task as arguments or stdin.", file=sys.stderr)
        return 2

    if args.print_prompt:
        print(build_router_prompt(task, args.max_files))
        return 0

    decision = (
        normalize_decision({"route": args.force, "confidence": 1, "reason": "Forced by CLI."})
        if args.force
        else route_with_qwen(task, args.router_model, args.max_files)
    )

    print(json.dumps(decision, indent=2))

    if args.dry_run:
        return 0

    route = decision["route"]
    if route == "LOCAL_QWEN":
        return launch_local(task, args)
    if route == "CODEX":
        return launch_codex(task, args)

    print("Ask a human before proceeding.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
