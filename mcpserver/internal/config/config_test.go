package config

import "testing"

func TestLoad_LocalTrustMode(t *testing.T) {
	t.Setenv("LOCAL_TRUST_MODE", "1")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load err: %v", err)
	}
	if !cfg.LocalTrustMode {
		t.Fatal("期望 Trust 模式（LOCAL_TRUST_MODE=1）")
	}

	t.Setenv("LOCAL_TRUST_MODE", "")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load err: %v", err)
	}
	if cfg.LocalTrustMode {
		t.Fatal("env 未设时应为 false")
	}
}

func TestLoad_LocalTrustMode_InvalidValue(t *testing.T) {
	for _, v := range []string{"true", "yes", "0", "on", "2"} {
		t.Setenv("LOCAL_TRUST_MODE", v)
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load(%q) err: %v", v, err)
		}
		if cfg.LocalTrustMode {
			t.Fatalf("LOCAL_TRUST_MODE=%q 不应触发 trust(严格 ==\"1\")", v)
		}
	}
}