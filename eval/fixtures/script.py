"""统计 CSV 文件的行数。

只依赖 Python 标准库（csv），不再需要 pandas。
"""

import csv
import sys


def count_rows(path):
    """返回 CSV 的数据行数（不含表头）。

    与原 pandas 版本 `len(pd.read_csv(path))` 语义一致：默认第一行是表头，
    空行不计入。使用 csv.reader 而不是按行统计，因此带引号的字段中即使含有
    换行符也能被正确算作一行。
    """
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        # 跳过空行（pandas 同样会忽略它们）
        rows = [row for row in reader if row and any(cell.strip() for cell in row)]
    return max(len(rows) - 1, 0)  # 去掉表头


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('用法: python script.py <csv文件路径>')
    try:
        print(count_rows(sys.argv[1]))
    except OSError as exc:
        sys.exit(f'无法读取 {sys.argv[1]}: {exc}')
