import { redirect } from 'next/navigation';

// Backward-compatible alias: watchlist / artifact deep links land on the
// embedded research panel inside the select workspace.
export default function StockSymbolRedirect({ params }: { params: { symbol: string } }) {
  redirect(`/select?code=${encodeURIComponent(params.symbol)}`);
}
