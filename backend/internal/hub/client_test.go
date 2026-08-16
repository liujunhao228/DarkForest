package hub

import "testing"

func TestSetObserver(t *testing.T) {
	c := &Client{}
	if c.IsObserverClient() {
		t.Fatal("expected non-observer by default")
	}
	if c.ObservedPlayerID() != "" {
		t.Fatalf("expected empty observed player, got %q", c.ObservedPlayerID())
	}

	c.SetObserver("agent:alice-player")
	if !c.IsObserverClient() {
		t.Fatal("expected observer after SetObserver")
	}
	if got := c.ObservedPlayerID(); got != "agent:alice-player" {
		t.Fatalf("ObservedPlayerID() = %q, want %q", got, "agent:alice-player")
	}
}
