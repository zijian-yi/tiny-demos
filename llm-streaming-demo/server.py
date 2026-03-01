"""
Streaming LLM Chatbot Demo - Server Side

This demonstrates how streaming works using Server-Sent Events (SSE).
We simulate an LLM generating tokens one at a time.

Refactored to show concrete details: manual request body parsing,
explicit ASGI streaming (each chunk sent over the wire in a visible loop).
"""

import asyncio
import json
import random
import time
from pathlib import Path

from starlette.applications import Starlette
from starlette.responses import Response, JSONResponse
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware


# ---------------------------------------------------------------------------
# Request body: read raw bytes, parse JSON ourselves (no Pydantic)
# ---------------------------------------------------------------------------

async def read_json_body(request):
    """Read request body and parse as JSON. Returns dict or None on error."""
    body = await request.body()
    if not body:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def get_message_from_body(data) -> str | None:
    """Extract 'message' from parsed body. Caller can validate."""
    if not data or not isinstance(data, dict):
        return None
    msg = data.get("message")
    return msg if isinstance(msg, str) else None


# ---------------------------------------------------------------------------
# Simulated LLM token generation
# ---------------------------------------------------------------------------

RESPONSES = {
    "default": list("I'm a simulated LLM! Each character you see is streamed as a separate token, "
                     "just like how real models like Claude or GPT work. "
                     "The key insight is that LLMs generate text **one token at a time** — "
                     "streaming simply sends each token to the client as soon as it's produced, "
                     "rather than waiting for the full response."),
}


def tokenize(text: str) -> list[str]:
    """Simulate tokenization by splitting into word-like chunks."""
    tokens = []
    current = ""
    for ch in text:
        current += ch
        if ch in (" ", "\n", ".", ",", "!", "?", ":", ";"):
            tokens.append(current)
            current = ""
    if current:
        tokens.append(current)
    return tokens


async def generate_tokens(message: str):
    """
    Simulate LLM token generation.
    In a real system, this would call the model's forward pass and yield tokens.
    """
    response_text = (
        f"You asked: \"{message}\"\n\n"
        "Here's how streaming works behind the scenes:\n\n"
        "1. **Your request** hits the server via a POST request.\n"
        "2. The server opens a **persistent HTTP connection** using chunked transfer encoding.\n"
        "3. The LLM generates tokens **one at a time** (autoregressive decoding).\n"
        "4. Each token is immediately sent as a **Server-Sent Event** (SSE) frame: `data: {\"token\": \"...\"}`\n"
        "5. The client reads the stream using `EventSource` or `fetch()` with a `ReadableStream`.\n"
        "6. JavaScript appends each token to the DOM, creating the **typewriter effect**.\n\n"
        "This is NOT a fake animation — each chunk arrives over the network separately! "
        "Open your browser's Network tab to see the individual SSE frames."
    )
    tokens = tokenize(response_text)
    for token in tokens:
        await asyncio.sleep(random.uniform(0.02, 0.08))
        yield token


async def stream_sse_chunks(message: str):
    """
    Produce SSE frames as bytes. Each yielded value is one chunk sent on the wire.
    Format: data: {"token": "..."}\n\n  then  data: [DONE]\n\n
    """
    async for token in generate_tokens(message):
        event_data = json.dumps({"token": token, "timestamp": time.time()})
        yield f"data: {event_data}\n\n".encode("utf-8")
    yield b"data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# ASGI: explicit streaming — we send each chunk via the protocol
# ---------------------------------------------------------------------------

SSE_HEADERS = [
    (b"content-type", b"text/event-stream"),
    (b"cache-control", b"no-cache"),
    (b"connection", b"keep-alive"),
    (b"x-accel-buffering", b"no"),
]


async def read_http_body(receive):
    """Read full body from ASGI receive()."""
    body = b""
    while True:
        event = await receive()
        if event["type"] == "http.request":
            body += event.get("body", b"")
            if not event.get("more_body", False):
                break
    return body


async def stream_route_asgi(scope, receive, send):
    """
    Handle POST /chat/stream at the ASGI level so the streaming loop is explicit.
    Each chunk is sent with send({"type": "http.response.body", "body": chunk, "more_body": True}).
    """
    # 1) Parse request body
    body = await read_http_body(receive)
    try:
        data = json.loads(body) if body else {}
    except json.JSONDecodeError:
        await send({
            "type": "http.response.start",
            "status": 400,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b'{"detail":"Invalid JSON"}', "more_body": False})
        return

    message = (data.get("message") or "").strip() if isinstance(data, dict) else ""
    if not message:
        message = "Tell me about streaming"

    # 2) Start response: status and SSE headers
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": SSE_HEADERS,
    })

    # 3) Stream each SSE frame as a separate chunk (this is what "chunked transfer" does)
    async for chunk in stream_sse_chunks(message):
        await send({
            "type": "http.response.body",
            "body": chunk,
            "more_body": True,
        })

    # 4) End of response
    await send({"type": "http.response.body", "body": b"", "more_body": False})


# ---------------------------------------------------------------------------
# Non-streaming /chat and static files (Starlette routes)
# ---------------------------------------------------------------------------

async def chat_nonstream(request):
    """Non-streaming endpoint: collect all tokens, then return JSON."""
    data = await read_json_body(request)
    message = get_message_from_body(data) or "Tell me about streaming"
    tokens = []
    async for token in generate_tokens(message):
        tokens.append(token)
    return JSONResponse({"response": "".join(tokens)})


# ---------------------------------------------------------------------------
# App: wire raw ASGI stream route first, then Starlette routes
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).resolve().parent / "static"
app = Starlette(
    debug=True,
    routes=[
        Route("/chat", chat_nonstream, methods=["POST"]),
        Mount("/", app=StaticFiles(directory=str(STATIC_DIR), html=True)),
    ],
    middleware=[Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])],
)


async def main_asgi(scope, receive, send):
    """Dispatch: POST /chat/stream handled with explicit streaming; else Starlette."""
    if scope["type"] == "http" and scope["path"] == "/chat/stream" and scope["method"] == "POST":
        await stream_route_asgi(scope, receive, send)
        return
    await app(scope, receive, send)


async def wrapped_app(scope, receive, send):
    """ASGI entry: /chat/stream uses explicit chunk loop; everything else uses Starlette."""
    await main_asgi(scope, receive, send)


def run():
    import uvicorn
    print("\n  Streaming LLM Demo Server")
    print("  Open http://localhost:8000 in your browser\n")
    # Point uvicorn at our wrapped app so we handle /chat/stream explicitly
    uvicorn.run(wrapped_app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    run()
