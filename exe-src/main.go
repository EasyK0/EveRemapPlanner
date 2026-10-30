// Planer remapu EVE: lokalny program, który pokazuje planer we własnym oknie.
// Serwuje wbudowaną stronę na 127.0.0.1:47321 (stały port, żeby przeglądarka pamiętała ustawienia)
// i zamyka się sam, gdy okno planera zostanie zamknięte.
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
	c, _ := syscall.UTF16PtrFromString("Planer remapu EVE")
	u.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10)
}

// Okno aplikacji: Edge (jest w każdym Windows 10/11) albo Chrome w trybie --app, inaczej domyślna przeglądarka.
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
		// Program już działa: otwórz tylko kolejne okno.
		if resp, e := http.Get(url + "ping"); e == nil {
			resp.Body.Close()
			openWindow()
			return
		}
		msgBox("Nie mogę uruchomić planera, port 47321 jest zajęty przez inny program.\n\n" + err.Error())
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

	// Strona pinguje co 5 s, a przy zamknięciu wysyła /bye. Po /bye bez nowego pingu przez 4 s program się zamyka.
	// Zminimalizowane okno pinguje rzadziej, więc bez /bye czekamy aż 3 min (90 s na pierwsze otwarcie).
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
