/**
 * 向后兼容 re-export：保留旧路径 `./CustomRulesEditor` 的导入入口。
 *
 * 实现已迁移至 `./matchmaking/CustomRulesEditor`，避免破坏现有 import。
 * 新代码请直接从 `./matchmaking/CustomRulesEditor` 导入。
 */

export { CustomRulesEditor, type CustomRulesEditorProps } from './matchmaking/CustomRulesEditor';
