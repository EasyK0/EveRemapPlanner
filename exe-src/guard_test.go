package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalOnly(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	h := localOnly(ok)
	cases := []struct {
		name, host, origin, site string
		want                     int
	}{
		{"window opens the page", addr, "", "none", 204},
		{"page pings", addr, "", "same-origin", 204},
		{"page says bye", addr, "http://" + addr, "same-origin", 204},
		{"localhost name", "localhost:47321", "http://localhost:47321", "same-origin", 204},
		{"old browser without fetch headers", addr, "", "", 204},
		{"dns rebinding", "evil.example:47321", "", "same-origin", 403},
		{"other site sends bye", addr, "https://evil.example", "cross-site", 403},
		{"other site without origin", addr, "", "cross-site", 403},
		{"same site subdomain", addr, "", "same-site", 403},
		{"sandboxed frame", addr, "null", "cross-site", 403},
	}
	for _, c := range cases {
		r := httptest.NewRequest("POST", "/bye", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		if c.site != "" {
			r.Header.Set("Sec-Fetch-Site", c.site)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s: got %d, want %d", c.name, w.Code, c.want)
		}
	}
}
