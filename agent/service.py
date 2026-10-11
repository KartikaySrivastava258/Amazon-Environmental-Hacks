"""Punarnava local agent service (Strands Agents SDK + a local model through Ollama). Nothing paid or hosted.

    POST /run    {task, input, tools: {url, token}} -> {provider, model, narrative: {summary, items: [{ref, text}]}}
    GET  /health -> {ok, provider, model, error?}

The agent gets tools that call back into the Punarnava server (/local/tools/*) with a short-lived grant scoped
to one job or model. It must answer only from tool data; the Node server re-checks every answer
(backend/src/core/assist.js, validateNarrative) and falls back to its rule-based answer if a check fails.
"""
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pydantic import BaseModel, Field
from strands import Agent, tool

PROVIDER = os.environ.get("AGENT_PROVIDER", "ollama")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("AGENT_MODEL", "llama3.1:8b")
PORT = int(os.environ.get("AGENT_PORT", "8790"))
HOST = os.environ.get("AGENT_HOST", "127.0.0.1")
RUNTIME = os.environ.get("AGENT_RUNTIME", "host")  # host | container | kubernetes | firecracker (set by the launcher)
LANGS = {"en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil"}


class Item(BaseModel):
    ref: str = Field(description="An ID exactly as returned by a tool: a component id, an option id or a rule id")
    text: str = Field(description="One short sentence")


class Narrative(BaseModel):
    summary: str = Field(description="Two or three short sentences")
    items: list[Item] = Field(default_factory=list, max_length=4)


def make_model():
    if PROVIDER != "ollama":
        raise RuntimeError(f"Unsupported AGENT_PROVIDER={PROVIDER}: only a local Ollama model is allowed")
    from strands.models.ollama import OllamaModel
    return OllamaModel(host=OLLAMA_HOST, model_id=MODEL, temperature=0.1)


def ollama_ready():
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=3) as r:
            names = [m.get("name", "") for m in json.load(r).get("models", [])]
        if not any(n == MODEL or n.split(":")[0] == MODEL.split(":")[0] for n in names):
            return f"model {MODEL} is not pulled (run: ollama pull {MODEL})"
        return None
    except Exception as e:  # noqa: BLE001
        return f"Ollama not reachable at {OLLAMA_HOST}: {e}"


def tool_caller(url, token):
    def call(name, args):
        req = urllib.request.Request(f"{url}/{name}", data=json.dumps(args).encode(), method="POST",
                                     headers={"content-type": "application/json", "authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            return {"error": e.read().decode()[:300]}
    return call


def build_tools(call):
    @tool
    def job_context(job_id: str) -> dict:
        """Product category, brand, model, age and the technician's recorded diagnosis for this job (no personal data)."""
        return call("job_context", {"jobId": job_id})

    @tool
    def catalog_components(category: str) -> dict:
        """Component ids and names for a product category, which are hazardous, and the required safety steps."""
        return call("catalog_components", {"category": category})

    @tool
    def model_failure_stats(brand: str, model: str) -> dict:
        """Recorded failure shares by component for one model, with sample sizes and rule-based design findings."""
        return call("model_failure_stats", {"brand": brand, "model": model})

    @tool
    def repair_options(job_id: str) -> dict:
        """The owner's options for this job with Punarnava's fair-price figures and the recommended option."""
        return call("repair_options", {"jobId": job_id})

    return [job_context, catalog_components, model_failure_stats, repair_options]


RULES = (
    "You help technicians and manufacturers in India. Use ONLY facts and numbers returned by your tools. "
    "Never invent prices, percentages, counts, warranties or safety assurances; never say anything is safe or guaranteed. "
    "Every item.ref must be an id exactly as a tool returned it. If the data is insufficient, say so. Be brief."
)
PROMPTS = {
    "diagnosis": "Job {jobId}: call job_context, then model_failure_stats for its brand and model and catalog_components "
                 "for its category. Suggest up to 3 components to check first (ref = component id) and why, from the data.",
    "recommendation": "Job {jobId}: call repair_options. Explain in plain words why the recommended option was recommended "
                      "and how the others compare (ref = option id).",
    "design": "Brand {brand}, model {model}: call model_failure_stats. Explain the design findings it returns "
              "(ref = rule id or component id), for a product engineer.",
}


def run(task, inp, tools_cfg):
    if task not in PROMPTS:
        raise ValueError(f"unknown task {task}")
    lang = LANGS.get(inp.get("lang", "en"), "English")
    agent = Agent(model=make_model(), tools=build_tools(tool_caller(tools_cfg["url"], tools_cfg["token"])),
                  system_prompt=f"{RULES} Write in {lang}.", callback_handler=None)
    prompt = PROMPTS[task].format(**{k: str(v) for k, v in inp.items()})
    agent(prompt)  # tool-using turn
    try:
        out = agent.structured_output(Narrative, "Now give the answer in the required structure.")
        return out.model_dump()
    except AttributeError:  # older SDKs without structured_output: ask for JSON and parse it
        text = str(agent('Reply with JSON only: {"summary": "...", "items": [{"ref": "...", "text": "..."}]}'))
        start, end = text.find("{"), text.rfind("}")
        return Narrative.model_validate_json(text[start:end + 1]).model_dump()


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        err = ollama_ready()
        return self._send(200, {"ok": err is None, "provider": f"strands+{PROVIDER}", "model": MODEL, "runtime": RUNTIME, **({"error": err} if err else {})})

    def do_POST(self):  # noqa: N802
        if self.path != "/run":
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            narrative = run(body.get("task"), body.get("input") or {}, body.get("tools") or {})
            return self._send(200, {"provider": f"strands+{PROVIDER}", "model": MODEL, "narrative": narrative})
        except Exception as e:  # noqa: BLE001
            return self._send(502, {"error": f"{type(e).__name__}: {e}"[:300]})

    def log_message(self, fmt, *args):  # no request bodies or answers in the logs
        print(f"agent {self.command} {self.path} {args[1] if len(args) > 1 else ''}")


if __name__ == "__main__":
    print(f"Punarnava agent (Strands, {PROVIDER} {MODEL}) on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
