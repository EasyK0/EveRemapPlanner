package main

import "net/http"

const addr = "127.0.0.1:47321"

// localOnly answers only requests addressed to this server and sent by the planner page itself.
// The Host check stops a web page that reaches the port through a DNS name pointing at
// 127.0.0.1 (DNS rebinding). The Origin and Sec-Fetch-Site checks stop another website from
// sending requests here, for example /bye, which would close the planner.
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != addr && r.Host != "localhost:47321" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && o != "http://"+addr && o != "http://localhost:47321" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		// Sent by every current browser: "none" when the user opens the address, "same-origin"
		// for the page's own requests. Requests started by another site are refused.
		if s := r.Header.Get("Sec-Fetch-Site"); s != "" && s != "none" && s != "same-origin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}
