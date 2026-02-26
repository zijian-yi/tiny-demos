# Rust server

Rust implementation of the same demo server behavior as `server.py`:

- `POST /chat` returns a normal non-streaming JSON response
- `POST /chat/stream` streams SSE chunks (`data: {"token":"..."}` + `data: [DONE]`)
- `GET /` serves `../static/index.html`

## Run

```bash
cd rs
cargo run
```

Optional custom port:

```bash
cd rs
PORT=8001 cargo run
```

Then open `http://localhost:8000` (or your custom port).

## Dependencies

Kept intentionally small:

- `tokio` (async runtime + timers + fs)
- `hyper` (HTTP server + streaming body channel)
- `serde_json` (request/response JSON parsing/encoding)
