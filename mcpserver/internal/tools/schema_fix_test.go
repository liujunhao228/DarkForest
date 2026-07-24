package tools

import (
	"encoding/json"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
)

// TestSchemaFix_WaitForEvent verifies that the outputSchemaFor helper generates
// a correct schema for WaitForEventOutput: json.RawMessage fields must NOT be
// typed as arrays of integers (the default []byte inference), but instead
// accept any JSON value.
func TestSchemaFix_WaitForEvent(t *testing.T) {
	// Default schema (without fix) — json.RawMessage becomes integer array
	defaultSchema, err := jsonschema.For[WaitForEventOutput](nil)
	if err != nil {
		t.Fatalf("default schema error: %v", err)
	}
	defaultBytes, _ := json.MarshalIndent(defaultSchema, "", "  ")
	t.Logf("DEFAULT (buggy) schema:\n%s", defaultBytes)

	// Verify the default schema has the bug: payload typed as array of integers
	assertPayloadIsArray(t, defaultBytes, "default schema should have the bug")

	// Fixed schema — json.RawMessage is unrestricted
	fixedSchema := outputSchemaFor[WaitForEventOutput]()
	fixedBytes, _ := json.MarshalIndent(fixedSchema, "", "  ")
	t.Logf("FIXED schema:\n%s", fixedBytes)

	// Verify the fixed schema does NOT type payload as array
	assertPayloadIsNotArray(t, fixedBytes, "fixed schema should not have the bug")
}

// assertPayloadIsArray checks that the events[].payload field is typed as
// "array" in the given schema JSON. Used to confirm the bug exists.
func assertPayloadIsArray(t *testing.T, schemaJSON []byte, msg string) {
	t.Helper()
	var schema map[string]any
	if err := json.Unmarshal(schemaJSON, &schema); err != nil {
		t.Fatalf("%s: failed to parse: %v", msg, err)
	}
	payload := nestedProp(t, schema, "properties", "events", "items", "properties", "payload")
	if payload == nil {
		t.Fatalf("%s: payload property not found", msg)
	}
	if _, ok := payload.(bool); ok {
		t.Fatalf("%s: payload is boolean schema (true), expected array type", msg)
	}
	payloadMap, ok := payload.(map[string]any)
	if !ok {
		t.Fatalf("%s: payload is %T, expected map", msg, payload)
	}
	if isArrayOfInteger(payloadMap) {
		return // bug confirmed
	}
	t.Fatalf("%s: payload is not typed as integer array: %v", msg, payloadMap)
}

// assertPayloadIsNotArray checks that events[].payload is NOT typed as
// "array" in the given schema JSON. Used to confirm the fix works.
func assertPayloadIsNotArray(t *testing.T, schemaJSON []byte, msg string) {
	t.Helper()
	var schema map[string]any
	if err := json.Unmarshal(schemaJSON, &schema); err != nil {
		t.Fatalf("%s: failed to parse: %v", msg, err)
	}
	payload := nestedProp(t, schema, "properties", "events", "items", "properties", "payload")
	if payload == nil {
		t.Fatalf("%s: payload property not found", msg)
	}
	// Boolean schema `true` means "any value" — acceptable, but we now prefer
	// an explicit any-type object schema (see rawJSONTypeSchema).
	if ok, isBool := payload.(bool); isBool {
		if !ok {
			t.Errorf("%s: payload is `false` (rejects all values)", msg)
		}
		return
	}
	payloadMap, ok := payload.(map[string]any)
	if !ok {
		t.Fatalf("%s: payload is %T, expected map or bool", msg, payload)
	}
	if isArrayOfInteger(payloadMap) {
		t.Errorf("%s: payload is still typed as integer array: %v", msg, payloadMap)
	}
}

// isArrayOfInteger 返回 true 当 schema 表示"整数数组"——即 json.RawMessage 被
// jsonschema-go 默认推断为 []byte 后生成的 integer 数组(本测试要捕获的 bug)。
// 不同 jsonschema-go 版本表现略有差异:可能是 {"type":"array","items":{"type":"integer"}}
// 或 {"type":["null","array"],"items":{"type":"integer",...}},两者都算 bug。
func isArrayOfInteger(m map[string]any) bool {
	typeVal, ok := m["type"]
	if !ok {
		return false
	}
	isArray := false
	switch v := typeVal.(type) {
	case string:
		isArray = v == "array"
	case []any:
		for _, t := range v {
			if t == "array" {
				isArray = true
			}
		}
	}
	if !isArray {
		return false
	}
	items, ok := m["items"].(map[string]any)
	if !ok {
		return false
	}
	itemType, ok := items["type"].(string)
	return ok && itemType == "integer"
}

// nestedProp traverses a chain of keys in a JSON-schema-like map and returns
// the value at the end, or nil if any key is missing.
func nestedProp(t *testing.T, obj map[string]any, keys ...string) any {
	t.Helper()
	current := any(obj)
	for _, key := range keys {
		m, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current, ok = m[key]
		if !ok {
			return nil
		}
	}
	return current
}
