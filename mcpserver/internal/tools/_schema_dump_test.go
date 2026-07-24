package tools

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
)

func dumpSchema(t *testing.T, name string, s *jsonschema.Schema) {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		t.Logf("%s marshal err: %v", name, err)
		return
	}
	t.Logf("=== %s ===\n%s\n", name, string(b))
}

func TestDumpReplaySchemas(t *testing.T) {
	dumpSchema(t, "GetReplayOutput", outputSchemaFor[GetReplayOutput]())
	dumpSchema(t, "GetLocalReplayOutput", outputSchemaFor[GetLocalReplayOutput]())
	dumpSchema(t, "GetReplayDeltasOutput", outputSchemaFor[GetReplayDeltasOutput]())
	dumpSchema(t, "FetchAndSaveReplayOutput", outputSchemaFor[FetchAndSaveReplayOutput]())
	dumpSchema(t, "ListMyReplaysOutput", outputSchemaFor[ListMyReplaysOutput]())
	dumpSchema(t, "ListLocalReplaysOutput", outputSchemaFor[ListLocalReplaysOutput]())
	_ = fmt.Sprint
}
