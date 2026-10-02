"""读入 CSV 并输出数据行数（不含表头）。

仅使用标准库实现，行为对齐 pandas.read_csv + len(df) 的常见语义：
- 首行作为表头，不计入行数；
- 跳过完全空白的行（pandas 的 skip_blank_lines=True 默认行为）；
- 空文件 / 仅表头 → 0；
- 兼容 UTF-8 BOM、CRLF、末行无换行、引号内含逗号或换行的字段。
"""

import csv
import sys


def count_rows(path):
    """返回 CSV 文件的数据行数（不含表头）。"""
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        try:
            next(reader)  # 表头
        except StopIteration:  # 空文件
            return 0
        # 空行会被 csv.reader 解析为 []，按 pandas 默认语义跳过
        return sum(1 for row in reader if row)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法: python script.py <csv 文件路径>', file=sys.stderr)
        sys.exit(2)
    print(count_rows(sys.argv[1]))
