"""读取 CSV 文件并输出数据行数（不含表头行）。

用法:
    python script.py <csv文件路径>
"""

import csv
import sys


def count_rows(path):
    with open(path, encoding='utf-8-sig', newline='') as fp:
        # 用 csv.reader 解析，带引号的字段里即使含换行也只算一行记录
        rows = [row for row in csv.reader(fp) if any(field.strip() for field in row)]
    # 第一行是表头，不计入
    return max(0, len(rows) - 1)


if __name__ == '__main__':
    print(count_rows(sys.argv[1]))