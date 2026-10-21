"""周/月 MTF 原子挂载列回归测试（2026-10-21 修复）。

根因：_prepare_hot_jit 把 MA_CLOSE_N 等列广播挂载到 df_weekly 原表；base_tf='W'
时 W. 原子解析命中挂载列，但 _eval_atom 的求值表是 build_asof_frame 重建表
（列白名单，无挂载列）→ ColumnNotFound 被吞 → 静默 0 结果。

修复后契约：
1. W/M 原子解析强制走慢路径（不引用挂载列），挂载列存在与否结果一致；
2. 原子求值异常在实时选股时转为 error dict，不再静默 0。
"""
import datetime
import unittest
from unittest.mock import patch

import polars as pl

from core.data_manager import data_manager
from core.engine import selection_engine
from core.selection_result import SelectionResult
from core.security import blink_parser


class TestMTFMountColumnRegression(unittest.TestCase):
    def setUp(self):
        self._orig_daily = data_manager.df_daily
        self._orig_weekly = data_manager.df_weekly
        self._orig_monthly = data_manager.df_monthly
        self._orig_mapping = data_manager.df_mapping
        data_manager.df_mapping = None
        data_manager._asof_frame_cache.clear()
        selection_engine._set_cache.clear()

        # 6 个完整周（收盘单调递增）+ 本周一~三（target=周三，partial 合成条）
        # 无论 group_by_dynamic 的周窗口如何对齐，最后一根 as-of 周线上
        # MA(CLOSE,2) > MA(CLOSE,4) 均应成立。
        dates, closes = [], []
        week_starts = [datetime.date(2026, 6, 29), datetime.date(2026, 7, 6),
                       datetime.date(2026, 7, 13), datetime.date(2026, 7, 20),
                       datetime.date(2026, 7, 27), datetime.date(2026, 8, 3)]
        base = 9.0
        for wi, ws in enumerate(week_starts):
            for d in range(5):
                dates.append(ws + datetime.timedelta(days=d))
                closes.append(base + wi * 0.5 + d * 0.02)
        for d in range(3):
            dates.append(datetime.date(2026, 8, 10) + datetime.timedelta(days=d))
            closes.append(12.0 + d * 0.1)

        self.df_daily = pl.DataFrame({
            "date": dates,
            "code": ["sh.600000"] * len(dates),
            "close": closes,
            "open": [c - 0.1 for c in closes],
            "high": [c + 0.2 for c in closes],
            "low": [c - 0.2 for c in closes],
            "volume": [1000000.0] * len(dates),
            "amount": [10000000.0] * len(dates),
        }).sort(["code", "date"])

        data_manager.df_daily = self.df_daily
        data_manager._resample_all()
        self.target_date = datetime.date(2026, 8, 12)  # 本周三

    def tearDown(self):
        data_manager.df_daily = self._orig_daily
        data_manager.df_weekly = self._orig_weekly
        data_manager.df_monthly = self._orig_monthly
        data_manager.df_mapping = self._orig_mapping
        data_manager._asof_frame_cache.clear()
        selection_engine._set_cache.clear()
        blink_parser.mount_enabled = True

    def _mounted_tables(self):
        """模拟 hot-jit 已把 MA_CLOSE_2/4 广播挂载到三张表。"""
        exprs = [
            pl.col("close").rolling_mean(2).alias("MA_CLOSE_2"),
            pl.col("close").rolling_mean(4).alias("MA_CLOSE_4"),
        ]
        data_manager.df_daily = data_manager.df_daily.with_columns(exprs)
        data_manager.df_weekly = data_manager.df_weekly.with_columns(exprs)
        data_manager.df_monthly = data_manager.df_monthly.with_columns(exprs)

    def test_mounted_columns_do_not_break_weekly_mtf(self):
        """挂载列存在时，W.MA(W.CLOSE,n) 原子必须与无挂载列时结果一致（非空）。"""
        formula = "W.MA(W.CLOSE, 2) > W.MA(W.CLOSE, 4)"

        # 无挂载列基线
        base = selection_engine.execute_selector(formula, "W", None,
                                                 target_date=self.target_date)
        self.assertIsInstance(base, SelectionResult, getattr(base, "error", None) or base)
        self.assertIn("sh.600000", base.codes)

        # 模拟 hot-jit 广播挂载后重跑（清缓存）
        self._mounted_tables()
        data_manager._asof_frame_cache.clear()
        selection_engine._set_cache.clear()
        mounted = selection_engine.execute_selector(formula, "W", None,
                                                    target_date=self.target_date)
        self.assertIsInstance(mounted, SelectionResult, getattr(mounted, "error", None) or mounted)
        self.assertEqual(set(mounted.codes), set(base.codes),
                         "挂载列不应改变 W/M 原子语义（修复前此处为 0）")

    def test_atom_eval_error_surfaces_as_error_dict(self):
        """原子求值异常必须冒泡为 error dict，不得静默返回 0。"""
        # 返回缺 close 列的 as-of frame → W.CLOSE > 0 求值必抛 ColumnNotFound
        broken = pl.DataFrame({
            "date": [self.target_date],
            "code": ["sh.600000"],
        })
        with patch.object(data_manager, "build_asof_frame", return_value=broken):
            out = selection_engine.execute_selector(
                "W.CLOSE > 0", "W", None, target_date=self.target_date)
        self.assertIn("error", out)
        self.assertIn("W.CLOSE > 0", str(out["error"]))


if __name__ == "__main__":
    unittest.main()
