package tools

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
)

func TestZZDumpReplay(t *testing.T) {
	for _, tc := range []struct {
		name string
		s    *jsonschema.Schema
	}{
		{"GetReplayOutput", outputSchemaFor[GetReplayOutput]()},
		{"GetLocalReplayOutput", outputSchemaFor[GetLocalReplayOutput]()},
	} {
		b, _ := json.MarshalIndent(tc.s, "", "  ")
		fmt.Printf("=== %s ===\n%s\n", tc.name, string(b))
	}
}
