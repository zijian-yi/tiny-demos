"""
Streaming LLM Chatbot Demo - Server Side

This demonstrates how streaming works using Server-Sent Events (SSE).
We simulate an LLM generating tokens one at a time.
"""

import asyncio
import json
import time
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ChatRequest(BaseModel):
    message: str


# Simulated LLM responses (token by token, like a real model would generate)
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

    In a real system, this would call the model's forward pass
    and yield tokens from the autoregressive decoding loop.
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
        # Simulate variable generation time (real LLMs have ~20-100ms per token)
        await asyncio.sleep(0.03)
        yield token


async def stream_response(message: str):
    """
    Stream response as Server-Sent Events.

    SSE Format:
        data: {"token": "Hello"}\n\n
        data: {"token": " world"}\n\n
        data: [DONE]\n\n

    The double newline marks the end of each event.
    This is the same format OpenAI, Anthropic, and others use.
    """
    async for token in generate_tokens(message):
        # Each SSE frame is a JSON object with the token
        event_data = json.dumps({"token": token, "timestamp": time.time()})
        yield f"data: {event_data}\n\n"

    # Signal stream completion (same convention as OpenAI's API)
    yield "data: [DONE]\n\n"


@app.post("/chat")
async def chat(req: ChatRequest):
    """
    Non-streaming endpoint for comparison.
    Waits for full response before sending — notice the delay!
    """
    tokens = []
    async for token in generate_tokens(req.message):
        tokens.append(token)
    return {"response": "".join(tokens)}


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """
    Streaming endpoint using Server-Sent Events.

    Key HTTP headers:
    - Content-Type: text/event-stream  (tells the browser this is SSE)
    - Cache-Control: no-cache           (don't cache the stream)
    - Transfer-Encoding: chunked        (send data in chunks)
    """
    return StreamingResponse(
        stream_response(req.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering if behind a proxy
        },
    )


# Serve static files (our frontend)
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

def main():
    import uvicorn
    print("\n  Streaming LLM Demo Server")
    print("  Open http://localhost:8000 in your browser\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
