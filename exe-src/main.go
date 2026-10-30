// EVE Remap Planner: a small local program that shows the planner in its own window.
// It serves the embedded page on 127.0.0.1:47321 (a fixed port, so the browser keeps the saved settings)
// and exits by itself when the planner window is closed.
package main

import (
	_ "embed"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

//go:embed remap-planner.html
var page []byte

const addr = "127.0.0.1:47321"
const url = "http://" + addr + "/"

func msgBox(text string) {
	u := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString("EVE Remap Planner")
	u.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10)
}

// App window: Edge (part of every Windows 10/11) or Chrome in --app mode, otherwise the default browser.
func openWindow() {
	var cands []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if base := os.Getenv(env); base != "" {
			cands = append(cands,
				filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
		}
	}
	for _, c := range cands {
		if _, err := os.Stat(c); err == nil {
			if exec.Command(c, "--app="+url, "--window-size=1320,920").Start() == nil {
				return
			}
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func main() {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		// Already running: just open another window.
		if resp, e := http.Get(url + "ping"); e == nil {
			resp.Body.Close()
			openWindow()
			return
		}
		msgBox("Cannot start the planner: port 47321 is used by another program.\n\n" + err.Error())
		return
	}

	var mu sync.Mutex
	last, seen := time.Now(), false
	mux := http.NewServeMux()
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		last, seen = time.Now(), true
		mu.Unlock()
		w.WriteHeader(204)
	})
	bye := time.Time{}
	mux.HandleFunc("/bye", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		bye = time.Now()
		mu.Unlock()
		w.WriteHeader(204)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(page)
	})
	go http.Serve(ln, mux)
	openWindow()

	// The page pings every 5 s and sends /bye when it closes. After /bye with no new ping for 4 s the program exits.
	// A minimized window pings less often, so without /bye we wait up to 3 min (90 s for the first open).
	for {
		time.Sleep(time.Second)
		mu.Lock()
		idle, s, b := time.Since(last), seen, bye
		mu.Unlock()
		if !b.IsZero() && b.After(last) && time.Since(b) > 4*time.Second {
			return
		}
		if (s && idle > 3*time.Minute) || (!s && idle > 90*time.Second) {
			return
		}
	}
}
