"""OAuth demo: Login with Codex PKCE flow, chat with OpenAI."""

import argparse
import base64
import hashlib
import json
import secrets
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from openai import OpenAI

ISSUER = "https://auth.openai.com"
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CALLBACK_PORT = 1455
REDIRECT_URI = f"http://localhost:{CALLBACK_PORT}/auth/callback"
TOKEN_FILE = Path(__file__).parent / ".codex_token.json"
CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"


def _generate_pkce() -> tuple[str, str]:
    """Generate PKCE code verifier and S256 challenge."""
    raw = secrets.token_bytes(64)
    verifier = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def _random_state() -> str:
    return (
        base64.urlsafe_b64encode(
            secrets.token_bytes(32),
        )
        .rstrip(b"=")
        .decode()
    )


def _decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload without verification (token is fresh)."""
    payload_b64 = token.split(".")[1]
    padding = 4 - len(payload_b64) % 4
    if padding != 4:
        payload_b64 += "=" * padding
    return json.loads(base64.urlsafe_b64decode(payload_b64))


def _extract_account_id(id_token: str) -> str | None:
    """Extract ChatGPT account ID from id_token JWT claims."""
    claims = _decode_jwt_payload(id_token)
    auth_claims = claims.get("https://api.openai.com/auth", {})
    return auth_claims.get("chatgpt_account_id")


def _exchange_tokens(code: str, verifier: str) -> dict:
    """Exchange auth code for OAuth tokens."""
    with httpx.Client() as http:
        resp = http.post(
            f"{ISSUER}/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": CLIENT_ID,
                "code_verifier": verifier,
            },
        )
        resp.raise_for_status()
        tokens = resp.json()

    account_id = _extract_account_id(tokens["id_token"])
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "account_id": account_id,
    }


def login() -> None:
    """Run OAuth PKCE login flow against OpenAI's auth server."""
    verifier, challenge = _generate_pkce()
    state = _random_state()
    result: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path != "/auth/callback":
                self.send_response(404)
                self.end_headers()
                return

            params = parse_qs(parsed.query)
            if params.get("state", [None])[0] != state:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"State mismatch")
                return

            if "code" in params:
                result["code"] = params["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(
                    b"<h1>Login successful!</h1><p>You can close this tab.</p>"
                )
            else:
                err = params.get(
                    "error_description",
                    params.get("error", ["unknown"]),
                )
                result["error"] = err[0]
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Login failed")

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", CALLBACK_PORT), Handler)
    ready = threading.Event()

    def serve() -> None:
        ready.set()
        server.handle_request()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    ready.wait()

    qs = urlencode(
        {
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid profile email offline_access",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
            "id_token_add_organizations": "true",
            "codex_cli_simplified_flow": "true",
            "originator": "codex_cli_rs",
        }
    )
    auth_url = f"{ISSUER}/oauth/authorize?{qs}"

    print("Opening browser for login...")
    print(f"If it doesn't open, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    thread.join(timeout=120)
    server.server_close()

    if "error" in result:
        print(f"Login failed: {result['error']}")
        sys.exit(1)
    if "code" not in result:
        print("Login timed out (2 minutes)")
        sys.exit(1)

    print("Exchanging authorization code for tokens...")
    token_data = _exchange_tokens(result["code"], verifier)
    TOKEN_FILE.write_text(json.dumps(token_data, indent=2))
    print(f"Login successful! Token saved to {TOKEN_FILE.name}")


def chat() -> None:
    """Interactive chat using the Codex backend with OAuth token."""
    if not TOKEN_FILE.exists():
        print("Not logged in. Run: python main_codex_oauth.py login")
        sys.exit(1)

    token_data = json.loads(TOKEN_FILE.read_text())

    headers: dict[str, str] = {"originator": "codex_cli_rs"}
    if token_data.get("account_id"):
        headers["ChatGPT-Account-ID"] = token_data["account_id"]

    client = OpenAI(
        api_key=token_data["access_token"],
        base_url=CODEX_BASE_URL,
        default_headers=headers,
    )

    print("Chat session started (Ctrl+C or 'quit' to exit)\n")
    messages: list[dict[str, str]] = []
    try:
        while True:
            user_input = input("You: ").strip()
            if not user_input or user_input.lower() in ("quit", "exit"):
                break

            messages.append({"role": "user", "content": user_input})
            print("Assistant: ", end="", flush=True)

            full_response = ""
            with client.responses.stream(
                model="gpt-5.3-codex",
                instructions="You are a helpful assistant.",
                input=messages,
                store=False,
            ) as stream:
                for event in stream:
                    if (
                        event.type == "response.output_text.delta"
                        and event.delta
                    ):
                        print(event.delta, end="", flush=True)
                        full_response += event.delta
            print()

            messages.append({"role": "assistant", "content": full_response})
    except KeyboardInterrupt:
        print("\nGoodbye!")


def main() -> None:
    parser = argparse.ArgumentParser(description="Codex OAuth Demo")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("login", help="Login with OpenAI Codex OAuth")
    sub.add_parser("chat", help="Chat using stored OAuth token")

    args = parser.parse_args()
    if args.command == "login":
        login()
    elif args.command == "chat":
        chat()


if __name__ == "__main__":
    main()
