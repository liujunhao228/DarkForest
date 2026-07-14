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
	if hasArrayType(payloadMap) {
		return // bug confirmed
	}
	t.Fatalf("%s: payload is not typed as array: %v", msg, payloadMap)
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
	// Boolean schema `true` means "any value" — this is the correct fix.
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
	if hasArrayType(payloadMap) {
		t.Errorf("%s: payload is still typed as array: %v", msg, payloadMap)
	}
}

// hasArrayType returns true if the schema map has type "array" (string or
// array containing "array").
func hasArrayType(m map[string]any) bool {
	typeVal, ok := m["type"]
	if !ok {
		return false
	}
	switch v := typeVal.(type) {
	case string:
		return v == "array"
	case []any:
		for _, t := range v {
			if t == "array" {
				return true
			}
		}
	}
	return false
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
