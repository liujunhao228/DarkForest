"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Shield, Copy, Check, Users, Key, LogOut, LogIn, Gamepad2 } from "lucide-react";
import { toast } from "sonner";

interface Player {
  id: string;
  displayName: string;
  role: string;
}

interface Invitation {
  id: string;
  code: string;
  isUsed: boolean;
  createdAt: string;
  usedAt: string | null;
  user: { displayName: string } | null;
}

export default function AdminPage() {
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  // 检查登录状态
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    const playerData = localStorage.getItem("player");

    if (!token || !playerData) {
      setError("未登录，请先登录管理员账号");
      setIsUnauthorized(true);
      setLoading(false);
      return;
    }

    const parsedPlayer = JSON.parse(playerData);
    if (parsedPlayer.role !== "admin") {
      setError("当前账号不是管理员，请使用管理员账号登录");
      setPlayer(parsedPlayer);
      setIsUnauthorized(true);
      setLoading(false);
      return;
    }

    setPlayer(parsedPlayer);
    loadInvitations(token);
  }, [router]);

  const loadInvitations = async (token: string) => {
    try {
      const res = await fetch("/api/auth/invite", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setError("加载邀请码失败");
        return;
      }

      const data = await res.json();
      setInvitations(data.invitations);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const generateInviteCode = useCallback(async () => {
    const token = localStorage.getItem("authToken");
    if (!token) return;

    try {
      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        toast.error("生成邀请码失败");
        return;
      }

      const data = await res.json();
      setInvitations((prev) => [data.invitation, ...prev]);
      toast.success("邀请码已生成");
    } catch {
      toast.error("网络错误");
    }
  }, []);

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`已复制: ${code}`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleLogout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("player");
    router.push("/auth");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>加载中...</p>
      </div>
    );
  }

  // 无权限状态：显示提示界面，不自动重定向
  if (isUnauthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Shield className="w-12 h-12 mx-auto text-destructive mb-2" />
            <CardTitle className="text-2xl">需要管理员权限</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Button
                className="w-full"
                onClick={() => {
                  localStorage.removeItem("authToken");
                  localStorage.removeItem("player");
                  router.push("/auth");
                }}
              >
                <LogIn className="w-4 h-4 mr-2" />
                更换管理员账号登录
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/")}
              >
                <Gamepad2 className="w-4 h-4 mr-2" />
                返回游戏
              </Button>
              {player && (
                <p className="text-sm text-center text-muted-foreground">
                  当前账号: {player.displayName} ({player.role})
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">管理面板</h1>
              <p className="text-muted-foreground">
                欢迎回来, {player?.displayName}
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            退出登录
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 邀请码管理 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  邀请码管理
                </CardTitle>
                <CardDescription>
                  生成并管理邀请码，控制谁可以注册
                </CardDescription>
              </div>
              <Button onClick={generateInviteCode}>
                <Key className="w-4 h-4 mr-2" />
                生成邀请码
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {invitations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Key className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>暂无邀请码</p>
                <p className="text-sm">点击上方按钮生成第一个邀请码</p>
              </div>
            ) : (
              <div className="space-y-2">
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      <code className="text-lg font-mono font-bold tracking-widest">
                        {inv.code}
                      </code>
                      <Badge variant={inv.isUsed ? "secondary" : "default"}>
                        {inv.isUsed ? "已使用" : "未使用"}
                      </Badge>
                      {inv.isUsed && inv.user && (
                        <span className="text-sm text-muted-foreground">
                          by {inv.user.displayName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(inv.createdAt).toLocaleDateString("zh-CN")}
                      </span>
                      {!inv.isUsed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(inv.code)}
                        >
                          {copiedCode === inv.code ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 统计信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              统计信息
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted">
                <p className="text-2xl font-bold">{invitations.length}</p>
                <p className="text-sm text-muted-foreground">总邀请码</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted">
                <p className="text-2xl font-bold">
                  {invitations.filter((i) => !i.isUsed).length}
                </p>
                <p className="text-sm text-muted-foreground">可用邀请码</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted">
                <p className="text-2xl font-bold">
                  {invitations.filter((i) => i.isUsed).length}
                </p>
                <p className="text-sm text-muted-foreground">已使用</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 快速操作 */}
        <Card>
          <CardHeader>
            <CardTitle>快速操作</CardTitle>
            <CardDescription>常用操作快捷入口</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="h-20"
                onClick={() => router.push("/")}
              >
                <div className="text-center">
                  <Gamepad2 className="w-6 h-6 mx-auto mb-1" />
                  <p>进入游戏</p>
                </div>
              </Button>
              <Button
                variant="outline"
                className="h-20"
                onClick={() => {
                  const codes = invitations
                    .filter((i) => !i.isUsed)
                    .map((i) => i.code)
                    .join("\n");
                  if (codes) {
                    navigator.clipboard.writeText(codes);
                    toast.success("已复制所有未使用邀请码");
                  }
                }}
              >
                <div className="text-center">
                  <Copy className="w-6 h-6 mx-auto mb-1" />
                  <p>复制所有可用邀请码</p>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
