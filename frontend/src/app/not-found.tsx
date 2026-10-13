import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-blue-600">404</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">页面不存在</h1>
        <p className="mt-2 text-sm text-slate-500">你访问的页面已被移动或删除。</p>
        <Link href="/select" className="mt-6 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
          返回选股
        </Link>
      </div>
    </div>
  );
}
