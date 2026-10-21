"""周/月表 PIT 基本面字段回归测试（2026-10-21 修复）。

根因：_resample_all 只聚合 OHLCV/amount，TOTAL_MV 等基本面列不在周/月表上，
周/月选股引用这些字段 → ColumnNotFound → 3 节点全 400（"All selection nodes failed"）。

修复契约：
1. _resample_all 将 _PIT_FORWARD_FILL_COLS 以窗口内最后交易日值（last()）聚合到周/月表；
2. build_asof_frame（W/M）保留并聚合 PIT 列（支持 W.TOTAL_MV 前缀原子）；
3. execute_selector('TOTAL_MV > …', 'W'/'M') 正常执行。
"""
import datetime
import unittest

import polars as pl

from core.data_manager import data_manager, _PIT_FORWARD_FILL_COLS
from core.engine import selection_engine
from core.security import blink_parser


class TestResamplePitColumns(unittest.TestCase):
    def setUp(self):
        self._orig = {a: getattr(data_manager, a) for a in
                      ("df_daily", "df_weekly", "df_monthly", "df_mapping",
                       "df_sector_daily")}
        self._orig_sw = getattr(data_manager, "df_sector_weekly", None)
        self._orig_sm = getattr(data_manager, "df_sector_monthly", None)
        data_manager.df_mapping = None
        data_manager._asof_frame_cache.clear()
        selection_engine._set_cache.clear()

        # 单股：2 个完整周 + 本周一~三；total_mv/pe_ttm 逐日变化
        dates, closes, tmv, pe = [], [], [], []
        week_starts = [datetime.date(2026, 8, 3), datetime.date(2026, 8, 10)]
        base = 1.0e12
        i = 0
        for ws in week_starts:
            for d in range(5):
                dates.append(ws + datetime.timedelta(days=d))
                closes.append(10.0 + i * 0.1)
                tmv.append(base + i * 1e10)
                pe.append(10.0 + i * 0.1)
                i += 1
        for d in range(3):
            dates.append(datetime.date(2026, 8, 17) + datetime.timedelta(days=d))
            closes.append(12.0 + d * 0.1)
            tmv.append(base + i * 1e10)
            pe.append(10.0 + i * 0.1)
            i += 1

        data_manager.df_daily = pl.DataFrame({
            "date": dates,
            "code": ["sh.600000"] * len(dates),
            "close": closes,
            "open": [c - 0.1 for c in closes],
            "high": [c + 0.2 for c in closes],
            "low": [c - 0.2 for c in closes],
            "volume": [1000000.0] * len(dates),
            "amount": [10000000.0] * len(dates),
            "total_mv": tmv,
            "pe_ttm": pe,
        }).sort(["code", "date"])
        data_manager._resample_all()
        self.target_date = datetime.date(2026, 8, 19)

    def tearDown(self):
        for a, v in self._orig.items():
            setattr(data_manager, a, v)
        data_manager.df_sector_weekly = self._orig_sw
        data_manager.df_sector_monthly = self._orig_sm
        data_manager._asof_frame_cache.clear()
        selection_engine._set_cache.clear()
        blink_parser.mount_enabled = True

    def test_weekly_monthly_have_pit_columns_last_value(self):
        for tf_df in (data_manager.df_weekly, data_manager.df_monthly):
            self.assertIsNotNone(tf_df)
            for c in ("total_mv", "pe_ttm"):
                self.assertIn(c, tf_df.columns)
        # 每根周 bar 的 total_mv 必须等于窗口内最后一个交易日的值
        daily = data_manager.df_daily
        for r in data_manager.df_weekly.iter_rows(named=True):
            window = daily.filter(
                (pl.col("code") == r["code"])
                & (pl.col("date") >= r["date"])
                & (pl.col("date") < r["date"] + datetime.timedelta(days=7))
            )
            expected = window.sort("date")["total_mv"][-1] if not window.is_empty() else None
            self.assertEqual(r["total_mv"], expected, f"weekly bar {r['date']}")

    def test_asof_frame_keeps_pit_columns(self):
        asof = data_manager.build_asof_frame("W", self.target_date)
        self.assertIn("total_mv", asof.columns)
        self.assertIn("pe_ttm", asof.columns)
        # partial 行（本周 as-of bar）取窗口内最后日线值
        last_daily = data_manager.df_daily.filter(
            pl.col("date") == self.target_date)
        partial_row = asof.filter(pl.col("date") == asof["date"].max())
        self.assertEqual(partial_row["total_mv"][0], last_daily["total_mv"][0])

    def test_weekly_selection_with_fundamental_field(self):
        out = selection_engine.execute_selector(
            "TOTAL_MV > 1.1e12", "W", None, target_date=self.target_date)
        self.assertTrue(hasattr(out, "codes"), getattr(out, "error", None) or out)
        self.assertIn("sh.600000", out.codes)

    def test_prefixed_atom_with_fundamental_field(self):
        out = selection_engine.execute_selector(
            "W.TOTAL_MV > 1.1e12", "W", None, target_date=self.target_date)
        self.assertTrue(hasattr(out, "codes"), getattr(out, "error", None) or out)
        self.assertIn("sh.600000", out.codes)

    def test_pit_cols_constant_covers_core_fundamentals(self):
        for c in ("total_mv", "float_mv", "pe_ttm", "pb_mrq"):
            self.assertIn(c, _PIT_FORWARD_FILL_COLS)


if __name__ == "__main__":
    unittest.main()
