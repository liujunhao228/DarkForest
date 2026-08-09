package game

// mode_rules_gen_parity_test.go
// 对拍锁：后端 ModeRulesExport（唯一真相源）必须逐字段覆盖 mcpserver 生成文件。
// 新增字段→改 codegen 模板（backend/cmd/codegen/main.go）→重跑 codegen，禁止手改生成物。

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// TestModeRulesGenParity 保证 mode_rules_gen.go 的两个 var 字面量键集合
// 与 ModeRulesExport 字段集完全一致（缺一或多一都是 FAIL）。
func TestModeRulesGenParity(t *testing.T) {
	genPath := filepath.Join("..", "..", "..", "mcpserver", "internal", "semantic", "mode_rules_gen.go")
	src, err := os.ReadFile(genPath)
	if err != nil {
		t.Fatalf("读取生成文件失败: %v", err)
	}
	f, err := parser.ParseFile(token.NewFileSet(), genPath, src, 0)
	if err != nil {
		t.Fatalf("解析生成文件失败: %v", err)
	}

	want := exportedModeRulesFields()
	for _, name := range []string{"classicModeRules", "relicsModeRules"} {
		keys := declaredKeys(t, f, name)
		for _, fName := range want {
			if !keys[fName] {
				t.Errorf("%s 生成文件缺字段 %q → 需补进 codegen 模板并重新生成", name, fName)
			}
		}
		for k := range keys {
			if !containsField(want, k) {
				t.Errorf("%s 生成文件出现多余字段 %q → 禁止手改生成物，请删模板该行并重新生成", name, k)
			}
		}
	}
}

// exportedModeRulesFields 返回 ModeRulesExport 的字段名集合（真相源）。
func exportedModeRulesFields() []string {
	typ := reflect.TypeOf(ModeRulesExport{})
	out := make([]string, 0, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		out = append(out, typ.Field(i).Name)
	}
	return out
}

func containsField(fields []string, name string) bool {
	for _, f := range fields {
		if f == name {
			return true
		}
	}
	return false
}

// declaredKeys 解析 var xxModeRules = ModeRules{...} 的键集合。
func declaredKeys(t *testing.T, f *ast.File, varName string) map[string]bool {
	t.Helper()
	keys := map[string]bool{}
	for _, decl := range f.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.VAR {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok || len(vs.Names) != 1 || vs.Names[0].Name != varName {
				continue
			}
			if len(vs.Values) != 1 {
				continue
			}
			cl, ok := vs.Values[0].(*ast.CompositeLit)
			if !ok {
				continue
			}
			for _, el := range cl.Elts {
				if kv, ok := el.(*ast.KeyValueExpr); ok {
					if ident, ok := kv.Key.(*ast.Ident); ok {
						keys[ident.Name] = true
					}
				}
			}
		}
	}
	return keys
}
