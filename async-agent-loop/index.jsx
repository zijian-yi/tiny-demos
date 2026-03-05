import { useState, useEffect, useRef, useCallback } from "react";

// ─── Event Log Entry ───────────────────────────────────────────────────────
function LogEntry({ entry, index }) {
    const colors = {
        eventloop: "#64748b",
        llm: "#3b82f6",
        spinner: "#a855f7",
        watchdog: "#f59e0b",
        chunk: "#10b981",
        tool: "#f97316",
        system: "#94a3b8",
        error: "#ef4444",
    };

    return (
        <div
            style={{
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
                padding: "2px 0",
                animation: "fadeSlideIn 0.15s ease-out both",
                animationDelay: `${index * 0.01}s`,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "11.5px",
                lineHeight: "1.6",
            }}
        >
            <span style={{ color: "#475569", minWidth: "60px", userSelect: "none" }}>
                {entry.time}ms
            </span>
            <span
                style={{
                    color: colors[entry.type] || "#94a3b8",
                    minWidth: "80px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    fontSize: "10px",
                    letterSpacing: "0.05em",
                    paddingTop: "1px",
                }}
            >
                [{entry.type}]
            </span>
            <span style={{ color: "#cbd5e1", flex: 1 }}>{entry.message}</span>
        </div>
    );
}

// ─── Token Stream Display ──────────────────────────────────────────────────
function TokenDisplay({ tokens, isStreaming }) {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    }, [tokens]);

    return (
        <div
            ref={ref}
            style={{
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: "8px",
                padding: "16px",
                minHeight: "120px",
                maxHeight: "200px",
                overflowY: "auto",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "13px",
                lineHeight: "1.7",
                color: "#e2e8f0",
                position: "relative",
            }}
        >
            <div style={{ color: "#475569", fontSize: "10px", marginBottom: "8px", letterSpacing: "0.1em" }}>
                LLM OUTPUT STREAM
            </div>
            <span>{tokens}</span>
            {isStreaming && (
                <span
                    style={{
                        display: "inline-block",
                        width: "2px",
                        height: "14px",
                        background: "#3b82f6",
                        marginLeft: "2px",
                        verticalAlign: "middle",
                        animation: "blink 0.7s step-end infinite",
                    }}
                />
            )}
        </div>
    );
}

// ─── Concurrency Lanes Visualizer ─────────────────────────────────────────
function ConcurrencyLane({ label, color, active, status, icon }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 12px",
                background: active ? `${color}11` : "#0f172a",
                border: `1px solid ${active ? color + "44" : "#1e293b"}`,
                borderRadius: "6px",
                transition: "all 0.2s ease",
            }}
        >
            <div
                style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: active ? color : "#334155",
                    boxShadow: active ? `0 0 8px ${color}` : "none",
                    transition: "all 0.2s ease",
                    flexShrink: 0,
                    animation: active ? "pulse 1s ease infinite" : "none",
                }}
            />
            <span style={{ fontSize: "10px", color: "#475569", fontFamily: "monospace", minWidth: "16px" }}>
                {icon}
            </span>
            <span
                style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "11px",
                    color: active ? color : "#475569",
                    fontWeight: active ? 600 : 400,
                    flex: 1,
                    transition: "color 0.2s",
                }}
            >
                {label}
            </span>
            <span
                style={{
                    fontSize: "10px",
                    color: active ? color + "cc" : "#334155",
                    fontFamily: "monospace",
                }}
            >
                {status}
            </span>
        </div>
    );
}

// ─── Main App ──────────────────────────────────────────────────────────────
export default function AsyncStreamDemo() {
    const [logs, setLogs] = useState([]);
    const [tokens, setTokens] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [lanes, setLanes] = useState({
        eventloop: false,
        llm: false,
        spinner: false,
        watchdog: false,
        tools: false,
    });
    const [spinnerFrame, setSpinnerFrame] = useState(0);
    const [watchdogTime, setWatchdogTime] = useState(0);
    const [phase, setPhase] = useState("idle"); // idle | streaming | tools | done | error
    const [toolResults, setToolResults] = useState([]);

    const logsRef = useRef(null);
    const startTimeRef = useRef(null);
    const abortRef = useRef(null);
    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    const elapsed = () => Math.round(performance.now() - startTimeRef.current);

    const addLog = useCallback((type, message) => {
        setLogs(prev => [...prev, { type, message, time: elapsed(), id: Math.random() }]);
    }, []);

    useEffect(() => {
        if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }, [logs]);

    // Spinner coroutine — runs independently
    useEffect(() => {
        if (!isRunning) return;
        const id = setInterval(() => {
            setSpinnerFrame(f => (f + 1) % spinnerFrames.length);
            setLanes(l => ({ ...l, spinner: true }));
            setTimeout(() => setLanes(l => ({ ...l, spinner: false })), 80);
        }, 120);
        return () => clearInterval(id);
    }, [isRunning]);

    // Watchdog coroutine — tracks elapsed time
    useEffect(() => {
        if (!isRunning) return;
        setWatchdogTime(0);
        const id = setInterval(() => {
            setWatchdogTime(t => {
                const next = t + 100;
                setLanes(l => ({ ...l, watchdog: true }));
                setTimeout(() => setLanes(l => ({ ...l, watchdog: false })), 60);
                return next;
            });
        }, 100);
        return () => clearInterval(id);
    }, [isRunning]);

    const runDemo = async () => {
        if (isRunning) return;

        // Reset state
        setLogs([]);
        setTokens("");
        setToolResults([]);
        setPhase("idle");
        setIsRunning(true);
        setIsStreaming(false);
        startTimeRef.current = performance.now();

        const abort = new AbortController();
        abortRef.current = abort;

        try {
            // ── PHASE 1: Event loop starts ────────────────────────────────────
            setLanes(l => ({ ...l, eventloop: true }));
            addLog("system", "agent_loop() started — event loop running");
            addLog("eventloop", "Task A (llm_call) scheduled");
            addLog("eventloop", "Task B (spinner) scheduled");
            addLog("eventloop", "Task C (watchdog) scheduled");
            await sleep(300);
            setLanes(l => ({ ...l, eventloop: false }));

            // ── PHASE 2: LLM streaming ────────────────────────────────────────
            setPhase("streaming");
            setLanes(l => ({ ...l, llm: true }));
            addLog("llm", "await llm_call() — Task A suspends, sends HTTP request");
            addLog("eventloop", "Task A suspended → spinner + watchdog now run freely");
            await sleep(200);

            addLog("llm", "First chunk arrived (epoll woke Task A)");
            setIsStreaming(true);

            // Real streaming API call
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: abort.signal,
                body: JSON.stringify({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 400,
                    stream: true,
                    system: "You are a coding assistant. Be concise. Respond in 3-4 sentences max.",
                    messages: [{
                        role: "user",
                        content: "Briefly explain what epoll does in Linux async I/O in 3 sentences."
                    }]
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const lines = text.split("\n").filter(l => l.startsWith("data: "));

                for (const line of lines) {
                    const data = line.slice(6);
                    if (data === "[DONE]") break;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                            const chunk = parsed.delta.text;
                            chunkCount++;
                            setTokens(t => t + chunk);
                            setLanes(l => ({ ...l, llm: true, eventloop: true }));

                            if (chunkCount % 5 === 0) {
                                addLog("chunk", `chunk #${chunkCount} arrived — Task A resumed by epoll`);
                            }

                            setTimeout(() => setLanes(l => ({ ...l, llm: false, eventloop: false })), 50);
                            await sleep(0); // yield to event loop between chunks
                        }
                    } catch { }
                }
            }

            setIsStreaming(false);
            setLanes(l => ({ ...l, llm: false }));
            addLog("llm", `Stream complete — ${chunkCount} chunks received`);
            addLog("eventloop", "Task A (llm_call) DONE — stop_reason: tool_use");
            await sleep(200);

            // ── PHASE 3: Tool fan-out ─────────────────────────────────────────
            setPhase("tools");
            addLog("eventloop", "asyncio.gather() — launching 3 tool calls concurrently");
            setLanes(l => ({ ...l, tools: true }));

            const toolDefs = [
                { name: "read_file('src/main.rs')", delay: 180, color: "#f97316" },
                { name: "run('cargo check')", delay: 420, color: "#f97316" },
                { name: "grep('epoll', './src')", delay: 240, color: "#f97316" },
            ];

            addLog("tool", `Spawning: ${toolDefs.map(t => t.name).join(" | ")}`);
            addLog("eventloop", "All 3 tools suspended — waiting on I/O concurrently");

            // Simulate concurrent tool execution
            const toolPromises = toolDefs.map(async (tool) => {
                await sleep(tool.delay);
                addLog("tool", `✓ ${tool.name} → complete (${tool.delay}ms)`);
                setToolResults(r => [...r, tool.name]);
                return tool.name;
            });

            await Promise.all(toolPromises);
            setLanes(l => ({ ...l, tools: false }));

            const maxDelay = Math.max(...toolDefs.map(t => t.delay));
            addLog("eventloop", `gather() resolved — total wait: ${maxDelay}ms (concurrent, not ${toolDefs.reduce((a, t) => a + t.delay, 0)}ms serial)`);

            // ── PHASE 4: Done ─────────────────────────────────────────────────
            setPhase("done");
            await sleep(200);
            addLog("system", "agent_loop() iteration complete — appending results");
            addLog("eventloop", "Loop continues → next LLM call...");
            setLanes(l => ({ ...l, eventloop: false }));

        } catch (err) {
            if (err.name !== "AbortError") {
                setPhase("error");
                addLog("error", `Error: ${err.message}`);
            }
        } finally {
            setIsRunning(false);
            setIsStreaming(false);
            setLanes({ eventloop: false, llm: false, spinner: false, watchdog: false, tools: false });
        }
    };

    const stop = () => {
        abortRef.current?.abort();
        setIsRunning(false);
        setIsStreaming(false);
        setPhase("idle");
        setLanes({ eventloop: false, llm: false, spinner: false, watchdog: false, tools: false });
    };

    const phaseColors = {
        idle: "#475569",
        streaming: "#3b82f6",
        tools: "#f97316",
        done: "#10b981",
        error: "#ef4444",
    };

    const phaseLabels = {
        idle: "IDLE",
        streaming: "STREAMING LLM RESPONSE",
        tools: "EXECUTING TOOLS (concurrent)",
        done: "LOOP ITERATION COMPLETE",
        error: "ERROR",
    };

    return (
        <div style={{
            minHeight: "100vh",
            background: "#020817",
            color: "#e2e8f0",
            fontFamily: "system-ui, sans-serif",
            padding: "24px",
            boxSizing: "border-box",
        }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@400;600;700;800&display=swap');
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar { width: 4px }
        ::-webkit-scrollbar-track { background: #0f172a }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px }
      `}</style>

            <div style={{ maxWidth: "900px", margin: "0 auto" }}>

                {/* Header */}
                <div style={{ marginBottom: "24px" }}>
                    <h1 style={{
                        fontFamily: "'Syne', sans-serif",
                        fontSize: "22px",
                        fontWeight: 800,
                        margin: "0 0 4px",
                        color: "#f1f5f9",
                        letterSpacing: "-0.02em",
                    }}>
                        Async Agent Loop — Live Demo
                    </h1>
                    <p style={{ margin: 0, fontSize: "12px", color: "#475569", fontFamily: "monospace" }}>
                        Real streaming from Anthropic API · concurrent tool execution · event loop visualization
                    </p>
                </div>

                {/* Phase indicator + controls */}
                <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "20px" }}>
                    <div style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        border: `1px solid ${phaseColors[phase]}44`,
                        background: `${phaseColors[phase]}11`,
                        fontSize: "11px",
                        fontFamily: "monospace",
                        color: phaseColors[phase],
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                    }}>
                        {isRunning && (
                            <span style={{ color: phaseColors[phase] }}>
                                {spinnerFrames[spinnerFrame]}
                            </span>
                        )}
                        {phaseLabels[phase]}
                    </div>

                    {isRunning && (
                        <div style={{
                            fontSize: "11px",
                            fontFamily: "monospace",
                            color: "#f59e0b",
                            padding: "6px 12px",
                            border: "1px solid #f59e0b22",
                            borderRadius: "20px",
                            background: "#f59e0b0a",
                        }}>
                            watchdog {(watchdogTime / 1000).toFixed(1)}s / 30s
                        </div>
                    )}

                    <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                        <button
                            onClick={runDemo}
                            disabled={isRunning}
                            style={{
                                padding: "8px 20px",
                                background: isRunning ? "#1e293b" : "#3b82f6",
                                color: isRunning ? "#475569" : "#fff",
                                border: "none",
                                borderRadius: "6px",
                                fontFamily: "'Syne', sans-serif",
                                fontWeight: 700,
                                fontSize: "12px",
                                cursor: isRunning ? "not-allowed" : "pointer",
                                letterSpacing: "0.03em",
                                transition: "all 0.2s",
                            }}
                        >
                            {isRunning ? "RUNNING..." : "▶ RUN AGENT LOOP"}
                        </button>
                        {isRunning && (
                            <button
                                onClick={stop}
                                style={{
                                    padding: "8px 16px",
                                    background: "transparent",
                                    color: "#ef4444",
                                    border: "1px solid #ef444433",
                                    borderRadius: "6px",
                                    fontFamily: "monospace",
                                    fontSize: "11px",
                                    cursor: "pointer",
                                }}
                            >
                                ✕ STOP
                            </button>
                        )}
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "16px" }}>

                    {/* Left column */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

                        {/* Token stream */}
                        <TokenDisplay tokens={tokens} isStreaming={isStreaming} />

                        {/* Event log */}
                        <div>
                            <div style={{
                                fontSize: "10px",
                                color: "#475569",
                                fontFamily: "monospace",
                                letterSpacing: "0.1em",
                                marginBottom: "8px",
                            }}>
                                EVENT LOOP LOG
                            </div>
                            <div
                                ref={logsRef}
                                style={{
                                    background: "#0a0f1a",
                                    border: "1px solid #1e293b",
                                    borderRadius: "8px",
                                    padding: "12px 16px",
                                    height: "280px",
                                    overflowY: "auto",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "1px",
                                }}
                            >
                                {logs.length === 0 ? (
                                    <div style={{ color: "#334155", fontFamily: "monospace", fontSize: "12px", margin: "auto", textAlign: "center" }}>
                                        Press "Run Agent Loop" to start
                                    </div>
                                ) : (
                                    logs.map((entry, i) => (
                                        <LogEntry key={entry.id} entry={entry} index={i} />
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Tool results */}
                        {toolResults.length > 0 && (
                            <div style={{
                                background: "#0f172a",
                                border: "1px solid #f9741622",
                                borderRadius: "8px",
                                padding: "12px 16px",
                            }}>
                                <div style={{ fontSize: "10px", color: "#f97316", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "8px" }}>
                                    TOOL RESULTS (gathered concurrently)
                                </div>
                                {toolResults.map((r, i) => (
                                    <div key={i} style={{
                                        fontSize: "12px",
                                        fontFamily: "monospace",
                                        color: "#94a3b8",
                                        padding: "3px 0",
                                        animation: "fadeSlideIn 0.2s ease both",
                                    }}>
                                        <span style={{ color: "#10b981" }}>✓</span> {r}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right column — concurrency lanes */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ fontSize: "10px", color: "#475569", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "4px" }}>
                            CONCURRENCY LANES
                        </div>

                        <ConcurrencyLane
                            label="event loop"
                            icon="⚡"
                            color="#64748b"
                            active={lanes.eventloop}
                            status={lanes.eventloop ? "dispatching" : "waiting"}
                        />
                        <ConcurrencyLane
                            label="llm_call (Task A)"
                            icon="🧠"
                            color="#3b82f6"
                            active={lanes.llm}
                            status={lanes.llm ? "streaming" : isRunning && phase === "streaming" ? "suspended" : "—"}
                        />
                        <ConcurrencyLane
                            label="spinner (Task B)"
                            icon={spinnerFrames[spinnerFrame]}
                            color="#a855f7"
                            active={lanes.spinner}
                            status={isRunning ? spinnerFrames[spinnerFrame] : "—"}
                        />
                        <ConcurrencyLane
                            label="watchdog (Task C)"
                            icon="⏱"
                            color="#f59e0b"
                            active={lanes.watchdog}
                            status={isRunning ? `${(watchdogTime / 1000).toFixed(1)}s` : "—"}
                        />
                        <ConcurrencyLane
                            label="tools (Task D)"
                            icon="🔧"
                            color="#f97316"
                            active={lanes.tools}
                            status={lanes.tools ? "running" : "—"}
                        />

                        {/* Legend */}
                        <div style={{
                            marginTop: "16px",
                            padding: "12px",
                            background: "#0a0f1a",
                            border: "1px solid #1e293b",
                            borderRadius: "8px",
                            fontSize: "10px",
                            fontFamily: "monospace",
                            color: "#475569",
                            lineHeight: "1.8",
                        }}>
                            <div style={{ color: "#334155", marginBottom: "6px", fontWeight: 600 }}>HOW TO READ:</div>
                            <div><span style={{ color: "#10b981" }}>●</span> active = task running</div>
                            <div><span style={{ color: "#334155" }}>●</span> dim = suspended</div>
                            <div style={{ marginTop: "8px" }}>
                                Spinner + watchdog stay active <em>even while</em> LLM streams — they run between chunk arrivals
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}