# LLM Streaming Demo

A minimal demo showing how modern LLM chatbots stream responses using Server-Sent Events (SSE).

## How it works

LLMs generate tokens one at a time (autoregressive decoding). Streaming sends each token to the client as it's produced rather than waiting for the full response. This dramatically improves perceived latency.

```
Client                    Server                     LLM
  |--- POST /chat/stream -->|                          |
  |                         |--- prompt --------------->|
  |<-- data: {"token":"Hi"} |<-- token: "Hi" ----------|
  |<-- data: {"token":"!"} -|<-- token: "!" -----------|
  |<-- data: [DONE] --------|<-- finish ----------------|
```

Key technologies:
- **Server-Sent Events (SSE)** — `Content-Type: text/event-stream` keeps the HTTP connection open
- **Chunked Transfer-Encoding** — server sends data frames without knowing total size upfront
- **ReadableStream API** — client reads chunks as they arrive via `fetch()` + `getReader()`

## Quick start

```bash
uv run python server.py
```

Then open http://localhost:8000.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/chat/stream` | POST | Streaming response via SSE |
| `/chat` | POST | Traditional non-streaming response |

Both accept `{"message": "..."}` as JSON body.

## What to try

1. Click **"Stream (SSE)"** and watch tokens arrive one by one
2. Click **"Normal"** and notice the delay before anything appears
3. Compare the **Time-To-First-Token (TTFT)** stats
4. Open **DevTools → Network** to inspect raw SSE frames on the wire

## Project structure

```
streaming-demo/
├── pyproject.toml    # uv project config & dependencies
├── server.py         # FastAPI server with streaming + non-streaming endpoints
├── static/
│   └── index.html    # Frontend: reads SSE stream and renders tokens
└── uv.lock
```
