'use client';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-red-600">出错了</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">页面加载失败</h1>
        <p className="mt-2 text-sm text-slate-500">请重试；若持续出现请联系管理员。</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          重试
        </button>
      </div>
    </div>
  );
}
