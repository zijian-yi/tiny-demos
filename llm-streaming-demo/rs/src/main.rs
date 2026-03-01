use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hyper::header::{HeaderValue, CACHE_CONTROL, CONNECTION, CONTENT_TYPE};
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Method, Request, Response, Server, StatusCode};
use serde_json::{json, Value};
use tokio::time::sleep;

const SSE_CONTENT_TYPE: &str = "text/event-stream";
const JSON_CONTENT_TYPE: &str = "application/json";

#[tokio::main]
async fn main() {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(8000);
    let addr = ([0, 0, 0, 0], port).into();

    println!("\n  Streaming LLM Demo Server (Rust)");
    println!("  Open http://localhost:{port} in your browser\n");

    let service = make_service_fn(|_conn| async { Ok::<_, Infallible>(service_fn(handle_request)) });
    let server = Server::bind(&addr).serve(service);

    if let Err(err) = server.await {
        eprintln!("server error: {err}");
    }
}

async fn handle_request(req: Request<Body>) -> Result<Response<Body>, Infallible> {
    let response = match (req.method(), req.uri().path()) {
        (&Method::POST, "/chat/stream") => handle_chat_stream(req).await,
        (&Method::POST, "/chat") => handle_chat(req).await,
        (&Method::GET, "/") | (&Method::GET, "/index.html") => serve_index().await,
        _ => not_found(),
    };
    Ok(response)
}

async fn handle_chat_stream(req: Request<Body>) -> Response<Body> {
    let body = match hyper::body::to_bytes(req.into_body()).await {
        Ok(bytes) => bytes,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Could not read request body"),
    };

    let message = parse_message(&body).unwrap_or_else(|| "Tell me about streaming".to_string());
    let tokens = tokenize(&build_response_text(&message));

    let (mut sender, body) = Body::channel();
    tokio::spawn(async move {
        for token in tokens {
            let payload = json!({
                "token": token,
                "timestamp": unix_now_secs(),
            });
            let frame = format!("data: {}\n\n", payload);
            if sender.send_data(frame.into()).await.is_err() {
                return;
            }
            sleep(Duration::from_millis(40)).await;
        }

        let _ = sender.send_data("data: [DONE]\n\n".into()).await;
    });

    let mut res = Response::new(body);
    *res.status_mut() = StatusCode::OK;
    apply_sse_headers(res.headers_mut());
    res
}

async fn handle_chat(req: Request<Body>) -> Response<Body> {
    let body = match hyper::body::to_bytes(req.into_body()).await {
        Ok(bytes) => bytes,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Could not read request body"),
    };

    let message = parse_message(&body).unwrap_or_else(|| "Tell me about streaming".to_string());
    let mut output = String::new();
    for token in tokenize(&build_response_text(&message)) {
        output.push_str(&token);
        sleep(Duration::from_millis(40)).await;
    }

    let mut res = Response::new(Body::from(json!({ "response": output }).to_string()));
    *res.status_mut() = StatusCode::OK;
    apply_json_headers(res.headers_mut());
    res
}

async fn serve_index() -> Response<Body> {
    let path = static_dir().join("index.html");
    match tokio::fs::read(path).await {
        Ok(bytes) => {
            let mut res = Response::new(Body::from(bytes));
            *res.status_mut() = StatusCode::OK;
            res.headers_mut().insert(
                CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            );
            res
        }
        Err(_) => text_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not load static/index.html",
        ),
    }
}

fn parse_message(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }

    let value: Value = serde_json::from_slice(bytes).ok()?;
    let message = value.get("message")?.as_str()?.trim();
    if message.is_empty() {
        return None;
    }
    Some(message.to_string())
}

fn build_response_text(message: &str) -> String {
    format!(
        "You asked: \"{message}\"\n\n\
Here's how streaming works behind the scenes:\n\n\
1. Your request hits the server via a POST request.\n\
2. The server opens a persistent HTTP connection using chunked transfer encoding.\n\
3. The LLM generates tokens one at a time.\n\
4. Each token is sent as an SSE frame: data: {{\"token\": \"...\"}}.\n\
5. The browser reads chunks and renders text immediately.\n\
6. This creates a typewriter effect with real network streaming.\n\n\
This is not a fake animation. Each chunk arrives separately over HTTP."
    )
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, ' ' | '\n' | '.' | ',' | '!' | '?' | ':' | ';') {
            tokens.push(current.clone());
            current.clear();
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn unix_now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}

fn static_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("static")
}

fn apply_json_headers(headers: &mut hyper::HeaderMap<HeaderValue>) {
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(JSON_CONTENT_TYPE));
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
}

fn apply_sse_headers(headers: &mut hyper::HeaderMap<HeaderValue>) {
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(SSE_CONTENT_TYPE));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(CONNECTION, HeaderValue::from_static("keep-alive"));
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
}

fn json_error(status: StatusCode, detail: &str) -> Response<Body> {
    let mut res = Response::new(Body::from(json!({ "detail": detail }).to_string()));
    *res.status_mut() = status;
    apply_json_headers(res.headers_mut());
    res
}

fn text_error(status: StatusCode, body: &str) -> Response<Body> {
    let mut res = Response::new(Body::from(body.to_string()));
    *res.status_mut() = status;
    res.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    res
}

fn not_found() -> Response<Body> {
    text_error(StatusCode::NOT_FOUND, "Not found")
}
