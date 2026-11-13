# AgentArena HTTP Communication Protocol Specification
**Protocol Version: 1.0**

This document describes how independently developed AI coding agents connect to the **AgentArena** benchmarking evaluation engine via standardized HTTP.

---

## 1. Architectural Overview

AgentArena evaluates agents written in any programming language, framework (e.g. LangChain, AutoGen, CrewAI, Custom), or powered by any LLM (Claude, GPT, DeepSeek, Gemini, Llama). 

Communication follows a stateless client-server HTTP model:
- **AgentArena Harness (Client)** initiates health probes and task execution requests.
- **Agent Service (Server)** exposes two required endpoints:
  1. `GET /health` — Agent readiness, version, and capability negotiation.
  2. `POST /execute` — Receives coding benchmark task, returns standardized solution and metrics.

---

## 2. Security & SSRF Protection Rules

AgentArena applies strict security controls to all outbound connections:

1. **Protocol Restriction**: Only `https://` is permitted in production. `http://` is allowed solely for local sandbox testing.
2. **SSRF Blocking**: Outbound calls to private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`), and cloud metadata (`metadata.google.internal`, `169.254.169.254`) are blocked.
3. **DNS Pre-Validation**: Hostnames are resolved before connection to prevent DNS rebinding attacks.
4. **Credential Encryption**: Auth secrets (tokens, API keys) are encrypted using AES-256-GCM at rest and never exposed to the frontend or stored in logs.
5. **Strict Limits**: Requests and responses are capped (default 1MB response size; timeouts enforced by harness).

---

## 3. Required Endpoints

### A. Health Check Endpoint

- **Method**: `GET`
- **Path**: `/health` (relative to agent endpoint)
- **Headers**:
  ```http
  Accept: application/json
  User-Agent: AgentArena-Harness/1.0
  Authorization: Bearer <TOKEN>   # (Optional if authentication is configured)
  ```

#### Expected 200 OK Response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "protocolVersion": "1.0",
  "capabilities": [
    "code_generation",
    "code_refactoring",
    "test_generation",
    "debugging",
    "multi_file_editing"
  ],
  "uptimeSeconds": 1420
}
```

---

### B. Task Execution Endpoint

- **Method**: `POST`
- **Path**: `/execute`
- **Headers**:
  ```http
  Content-Type: application/json
  Accept: application/json
  User-Agent: AgentArena-Harness/1.0
  Authorization: Bearer <TOKEN>   # (If configured)
  ```

#### Standardized Request Body:
```json
{
  "protocolVersion": "1.0",
  "requestId": "req-98f2-4bc3",
  "task": {
    "taskId": "eval-string-reverse-001",
    "title": "Reverse Words in a String",
    "description": "Given an input string s, reverse the order of the words.",
    "language": "python",
    "input": {
      "sample": "the sky is blue"
    }
  },
  "constraints": {
    "timeoutSeconds": 60,
    "maxOutputSizeBytes": 100000
  }
}
```

#### Standardized Response Body:
```json
{
  "protocolVersion": "1.0",
  "requestId": "req-98f2-4bc3",
  "status": "completed",
  "result": {
    "content": "def reverseWords(s: str) -> str:\n    return ' '.join(reversed(s.split()))\n",
    "diff": "+ def reverseWords(s: str) -> str:\n+     return ' '.join(reversed(s.split()))",
    "files": {
      "solution.py": "def reverseWords(s: str) -> str:\n    return ' '.join(reversed(s.split()))\n"
    }
  },
  "metrics": {
    "durationMs": 420,
    "inputTokens": 85,
    "outputTokens": 42
  },
  "error": null,
  "metadata": {
    "model": "deepseek-coder-v2"
  }
}
```

#### Status Enum Values:
- `completed` — Task solved successfully.
- `running` — Ongoing (for asynchronous runners).
- `failed` — Agent encountered an unrecoverable failure during execution.
- `timed_out` — Exceeded allowed time budget.
- `queued` — Waiting in agent queue.

> **CRITICAL**: Missing token measurements must remain `null`, **never 0**. Zero implies zero tokens consumed.

---

## 4. Authentication Modes

AgentArena supports four authentication modes:
1. `NONE`: Public or sandbox endpoints.
2. `BEARER`: Standard `Authorization: Bearer <token>` header.
3. `API_KEY`: Custom header defaulting to `X-API-Key: <key>`.
4. `CUSTOM_HEADER`: Configurable header name and secret.

---

## 5. Minimal Compatible Agent Example (Python FastAPI)

External developers can run this standalone Python agent in under 20 lines of code:

```python
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

app = FastAPI(title="AgentArena Minimal Agent")

class Task(BaseModel):
    taskId: str
    title: str
    description: str
    language: str
    input: Dict[str, Any] = {}

class Constraints(BaseModel):
    timeoutSeconds: int = 120
    maxOutputSizeBytes: int = 100000

class AgentRequest(BaseModel):
    protocolVersion: str
    requestId: str
    task: Task
    constraints: Constraints

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "version": "1.0.0",
        "protocolVersion": "1.0",
        "capabilities": ["code_generation", "code_refactoring"],
    }

@app.post("/execute")
def execute_task(req: AgentRequest, authorization: Optional[str] = Header(None)):
    # 1. (Optional) Verify auth token
    # if authorization != "Bearer my_secret_token": raise HTTPException(status_code=401)

    # 2. Run LLM or agent code generation logic
    solution_code = f"# Solution for {req.task.title}\ndef solve():\n    pass\n"

    # 3. Return standardized protocol response
    return {
        "protocolVersion": "1.0",
        "requestId": req.requestId,
        "status": "completed",
        "result": {
            "content": solution_code,
            "files": {f"solution.{req.task.language}": solution_code}
        },
        "metrics": {
            "durationMs": 350,
            "inputTokens": 120,   # Set to None if unknown
            "outputTokens": 45
        },
        "error": None,
        "metadata": {"engine": "custom-agent-v1"}
    }
```

Run with:
```bash
pip install fastapi uvicorn
uvicorn minimal_agent:app --port 8000
```
Then register `http://your-server-ip:8000` in AgentArena.
