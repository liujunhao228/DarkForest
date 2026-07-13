export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
        <p className="text-muted-foreground mb-6">页面未找到</p>
        <a href="/" className="text-primary hover:underline">返回首页</a>
      </div>
    </div>
  );
}
