# claude-code-sniffer

HTTP proxy that forwards requests to the Anthropic API and logs request/response bodies as JSON. Useful for inspecting what Claude Code is doing under the hood.

## Run

```bash
go run main.go [-port 11333] [-dir logs]
ANTHROPIC_BASE_URL="http://localhost:11333" claude
```

- **`-port`** — Listen port (default: 11333)
- **`-dir`** — Output directory for `req_N.json` and `res_N.json` (default: current dir)
