"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertCircle, CheckCircle2 } from "lucide-react";

function AdminSetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const secretFromUrl = searchParams.get("secret") || "";

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState(secretFromUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/admin-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, password, secret }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "创建失败");
        return;
      }

      // 保存 token
      localStorage.setItem("authToken", data.token);
      localStorage.setItem("player", JSON.stringify(data.player));

      setSuccess(true);

      // 跳转到管理面板
      setTimeout(() => {
        router.push("/admin");
      }, 1000);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-2" />
          <CardTitle className="text-green-600">创建成功</CardTitle>
          <CardDescription>管理员账号已创建，正在跳转到管理面板...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <Shield className="w-12 h-12 mx-auto text-primary mb-2" />
        <CardTitle>创建管理员账号</CardTitle>
        <CardDescription>
          首次部署时创建管理员账号
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="displayName">显示名称</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：房主"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              required
              minLength={6}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret">管理员密钥</Label>
            <Input
              id="secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="从 .env 文件获取"
              required
            />
            <p className="text-xs text-muted-foreground">
              在 <code className="bg-muted px-1 py-0.5 rounded">.env</code> 中的{" "}
              <code className="bg-muted px-1 py-0.5 rounded">ADMIN_SECRET_KEY</code> 查看
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "创建中..." : "创建管理员账号"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function AdminSetupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Suspense fallback={<div>加载中...</div>}>
        <AdminSetupForm />
      </Suspense>
    </div>
  );
}
