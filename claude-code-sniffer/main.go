package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
)

var reqCount atomic.Int64

func main() {
	port := flag.Int("port", 11333, "listen port")
	dir := flag.String("dir", ".", "output directory for logged files")
	flag.Parse()
	
	fmt.Println("dir: ", *dir)
	fmt.Println("port: ", *port)
	// os.Exit(1)

	if *dir != "." {
		if err := os.MkdirAll(*dir, 0o755); err != nil {
			log.Fatalf("create output dir: %v", err)
		}
	}

	p := &proxy{dir: *dir}
	addr := fmt.Sprintf(":%d", *port)
	log.Printf("listening on %s, logging to %s/", addr, *dir)
	log.Fatal(http.ListenAndServe(addr, p))
}

type proxy struct{ dir string }

func (p *proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	n := reqCount.Add(1)
	log.Printf("#%d %s %s", n, r.Method, r.URL.Path)

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	r.Body.Close()

	p.saveJSON(fmt.Sprintf("req_%d.json", n), body)

	var parsed map[string]any
	stream := false
	if json.Unmarshal(body, &parsed) == nil {
		stream, _ = parsed["stream"].(bool)
	}

	upstream := "https://api.anthropic.com" + r.URL.RequestURI()
	fwd, err := http.NewRequestWithContext(
		r.Context(), r.Method, upstream, bytes.NewReader(body),
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	for k, vs := range r.Header {
		for _, v := range vs {
			fwd.Header.Add(k, v)
		}
	}
	fwd.Header.Del("Host")
	fwd.Header.Del("Accept-Encoding")

	resp, err := http.DefaultClient.Do(fwd)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}

	if stream && resp.StatusCode == http.StatusOK {
		p.proxyStream(w, resp.Body, n)
	} else {
		p.proxyBuffer(w, resp, n)
	}

	log.Printf("#%d done status=%d stream=%v", n, resp.StatusCode, stream)
}

func (p *proxy) proxyBuffer(
	w http.ResponseWriter, resp *http.Response, n int64,
) {
	w.WriteHeader(resp.StatusCode)
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("#%d read error: %v", n, err)
		return
	}
	p.saveJSON(fmt.Sprintf("res_%d.json", n), data)
	w.Write(data)
}

func (p *proxy) proxyStream(
	w http.ResponseWriter, body io.Reader, n int64,
) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)

	var events []json.RawMessage
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for sc.Scan() {
		line := sc.Text()
		fmt.Fprintf(w, "%s\n", line)
		flusher.Flush()

		if after, found := strings.CutPrefix(line, "data: "); found {
			if json.Valid([]byte(after)) {
				events = append(events, json.RawMessage(after))
			}
		}
	}
	if err := sc.Err(); err != nil {
		log.Printf("#%d stream error: %v", n, err)
	}

	out, _ := json.MarshalIndent(events, "", "  ")
	os.WriteFile(p.filePath(fmt.Sprintf("res_%d.json", n)), out, 0o644)
}

func (p *proxy) saveJSON(name string, data []byte) {
	var buf bytes.Buffer
	if json.Indent(&buf, data, "", "  ") == nil {
		data = buf.Bytes()
	}
	if err := os.WriteFile(p.filePath(name), data, 0o644); err != nil {
		log.Printf("write %s: %v", name, err)
	}
}

func (p *proxy) filePath(name string) string {
	return filepath.Join(p.dir, name)
}
