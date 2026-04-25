import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules - 收紧以提升代码质量
    "@typescript-eslint/no-explicit-any": "warn",  // 警告：避免类型安全丧失
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],  // 允许 _ 前缀忽略
    "@typescript-eslint/no-non-null-assertion": "warn",  // 警告：使用可选链更安全
    "@typescript-eslint/ban-ts-comment": "warn",  // 警告：避免隐藏类型错误
    "@typescript-eslint/prefer-as-const": "warn",  // 启用：推荐实践

    // React rules - 启用关键规则
    "react-hooks/exhaustive-deps": "warn",  // 警告：防止闭包陷阱
    "react-hooks/purity": "warn",  // 警告：保持 hooks 纯净
    "react/no-unescaped-entities": "off",  // 保持关闭：JSX 中常见
    "react/display-name": "off",  // 保持关闭：Next.js 不需要
    "react/prop-types": "off",  // 保持关闭：使用 TypeScript
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",  // 保持关闭：项目使用 img
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules - 启用质量检查
    "prefer-const": "warn",  // 警告：不变变量应使用 const
    "no-unused-vars": "off",  // 关闭：使用 TypeScript 版本
    "no-console": "off",  // 保持关闭：开发需要日志
    "no-debugger": "warn",  // 警告：生产不应保留 debugger
    "no-empty": "warn",  // 警告：空块应有注释说明
    "no-irregular-whitespace": "warn",  // 警告：避免隐藏字符
    "no-case-declarations": "off",  // 保持关闭：switch 中声明变量常见
    "no-fallthrough": "warn",  // 警告：防止意外穿透
    "no-mixed-spaces-and-tabs": "warn",  // 警告：保持一致
    "no-redeclare": "off",  // 关闭：TypeScript 处理
    "no-undef": "off",  // 关闭：TypeScript 处理
    "no-unreachable": "off",  // 关闭：TypeScript 处理
    "no-useless-escape": "warn",  // 警告：清理冗余转义
  },
}, {
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "examples/**",
    "skills",
    "ai/.venv/**",
    "ai/**",
    "nanobot/**",
    "*.config.js",
    "server.js",
    "server.merged.js",
    "create-admin.js",
    "check-admin.js",
  ]
}];

export default eslintConfig;
